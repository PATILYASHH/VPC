const syncService = require('./syncService');
const banadbService = require('./banadbService');

/**
 * Get next PR number for a project.
 */
async function getNextPrNumber(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(pr_number), 0) + 1 AS next FROM vpc_pull_requests WHERE project_id = $1`,
    [projectId]
  );
  return rows[0].next;
}

/**
 * Create a new pull request.
 */
async function createPullRequest(pool, { projectId, title, description, sqlContent, submittedBy = 'vpcsync' }) {
  const prNumber = await getNextPrNumber(pool, projectId);
  const sqlDown = syncService.generateReverseSQL(sqlContent);

  const { rows } = await pool.query(
    `INSERT INTO vpc_pull_requests (project_id, pr_number, title, description, sql_content, sql_down, submitted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [projectId, prNumber, title, description || null, sqlContent, sqlDown, submittedBy]
  );
  return rows[0];
}

/**
 * List pull requests for a project.
 */
async function getPullRequests(pool, projectId, { status, page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const conditions = ['project_id = $1'];
  const params = [projectId];

  if (status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(status);
  }

  const where = conditions.join(' AND ');

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT * FROM vpc_pull_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM vpc_pull_requests WHERE ${where}`, params),
  ]);

  return { pull_requests: rows, total: countRows[0].count, page, limit };
}

/**
 * Get a single PR by UUID.
 */
async function getPullRequest(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM vpc_pull_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Get a PR by project + pr_number.
 */
async function getPullRequestByNumber(pool, projectId, prNumber) {
  const { rows } = await pool.query(
    `SELECT * FROM vpc_pull_requests WHERE project_id = $1 AND pr_number = $2`,
    [projectId, parseInt(prNumber)]
  );
  return rows[0] || null;
}

/**
 * Update PR fields.
 */
async function updatePullRequest(pool, id, updates) {
  const sets = [];
  const params = [id];
  let idx = 2;

  for (const [key, val] of Object.entries(updates)) {
    if (['title', 'description', 'status', 'sandbox_result', 'conflict_result', 'reviewed_by', 'merged_by', 'migration_id'].includes(key)) {
      sets.push(`${key} = $${idx}`);
      params.push(key.endsWith('_result') ? JSON.stringify(val) : val);
      idx++;
    }
  }

  if (sets.length === 0) return null;
  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE vpc_pull_requests SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0];
}

/**
 * Test a PR in sandbox (transaction rollback) + conflict check.
 */
async function testPullRequest(pool, project, prId) {
  const pr = await getPullRequest(pool, prId);
  if (!pr) throw new Error('Pull request not found');
  if (pr.status === 'merged') throw new Error('Cannot test a merged PR');

  // Mark as testing
  await updatePullRequest(pool, prId, { status: 'testing' });

  try {
    // Run sandbox test
    const sandboxResult = await syncService.testMigrationInSandbox(project, pr.sql_content);

    // Run conflict check
    const conflictResult = await checkConflicts(pool, project, pr);

    // Determine final status
    let newStatus = 'open';
    if (!sandboxResult.success || conflictResult.has_conflicts) {
      newStatus = 'conflict';
    }

    const updated = await updatePullRequest(pool, prId, {
      status: newStatus,
      sandbox_result: sandboxResult,
      conflict_result: conflictResult,
    });

    return { pr: updated, sandbox_result: sandboxResult, conflict_result: conflictResult };
  } catch (err) {
    await updatePullRequest(pool, prId, {
      status: 'conflict',
      sandbox_result: { success: false, error: err.message },
    });
    throw err;
  }
}

/**
 * Check for conflicts between PR SQL and current schema.
 */
async function checkConflicts(pool, project, pr) {
  const projectPool = banadbService.getProjectPool(project);
  const snapshot = await syncService.getSchemaSnapshot(projectPool);
  const operations = parseDDLOperations(pr.sql_content);

  const tableNames = new Set(snapshot.tables.map(t => t.name));
  const columnMap = {};
  const indexNames = new Set();

  for (const table of snapshot.tables) {
    columnMap[table.name] = new Set(table.columns.map(c => c.column_name));
    for (const idx of (table.indexes || [])) {
      indexNames.add(idx.indexname);
    }
  }

  const conflicts = [];

  for (const op of operations) {
    switch (op.type) {
      case 'CREATE_TABLE':
        if (tableNames.has(op.object)) {
          conflicts.push({ type: 'CREATE_TABLE', object: op.object, message: `Table "${op.object}" already exists` });
        }
        break;
      case 'DROP_TABLE':
        if (!tableNames.has(op.object)) {
          conflicts.push({ type: 'DROP_TABLE', object: op.object, message: `Table "${op.object}" does not exist` });
        }
        break;
      case 'ADD_COLUMN': {
        const [table, col] = op.object.split('.');
        if (!tableNames.has(table)) {
          conflicts.push({ type: 'ADD_COLUMN', object: op.object, message: `Table "${table}" does not exist` });
        } else if (columnMap[table]?.has(col)) {
          conflicts.push({ type: 'ADD_COLUMN', object: op.object, message: `Column "${col}" already exists on "${table}"` });
        }
        break;
      }
      case 'DROP_COLUMN': {
        const [table, col] = op.object.split('.');
        if (tableNames.has(table) && !columnMap[table]?.has(col)) {
          conflicts.push({ type: 'DROP_COLUMN', object: op.object, message: `Column "${col}" does not exist on "${table}"` });
        }
        break;
      }
      case 'CREATE_INDEX':
        if (indexNames.has(op.object)) {
          conflicts.push({ type: 'CREATE_INDEX', object: op.object, message: `Index "${op.object}" already exists` });
        }
        break;
    }
  }

  // Check collisions with other open PRs
  const { rows: openPRs } = await pool.query(
    `SELECT id, pr_number, title, sql_content FROM vpc_pull_requests WHERE project_id = $1 AND status IN ('open', 'testing') AND id != $2`,
    [pr.project_id, pr.id]
  );

  for (const otherPR of openPRs) {
    const otherOps = parseDDLOperations(otherPR.sql_content);
    for (const op of operations) {
      for (const otherOp of otherOps) {
        if (op.object === otherOp.object && op.type !== 'OTHER') {
          conflicts.push({
            type: 'PR_COLLISION',
            object: op.object,
            message: `Conflicts with open PR #${otherPR.pr_number} "${otherPR.title}" — both modify ${op.object}`,
          });
          break;
        }
      }
    }
  }

  return { has_conflicts: conflicts.length > 0, conflicts };
}

/**
 * Parse DDL operations from SQL.
 */
function parseDDLOperations(sql) {
  const operations = [];
  const lines = sql.split(';').map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    const upper = line.toUpperCase().replace(/\s+/g, ' ').trim();

    const createTable = upper.match(/^CREATE TABLE (?:IF NOT EXISTS )?(\S+)/);
    if (createTable) {
      operations.push({ type: 'CREATE_TABLE', object: createTable[1].toLowerCase().replace(/^public\./, '') });
      continue;
    }

    const dropTable = upper.match(/^DROP TABLE (?:IF EXISTS )?(\S+)/);
    if (dropTable) {
      operations.push({ type: 'DROP_TABLE', object: dropTable[1].toLowerCase().replace(/^public\./, '') });
      continue;
    }

    const addColumn = upper.match(/^ALTER TABLE (\S+) ADD (?:COLUMN )?(\S+)/);
    if (addColumn) {
      operations.push({ type: 'ADD_COLUMN', object: `${addColumn[1].toLowerCase().replace(/^public\./, '')}.${addColumn[2].toLowerCase()}` });
      continue;
    }

    const dropColumn = upper.match(/^ALTER TABLE (\S+) DROP (?:COLUMN )?(?:IF EXISTS )?(\S+)/);
    if (dropColumn) {
      operations.push({ type: 'DROP_COLUMN', object: `${dropColumn[1].toLowerCase().replace(/^public\./, '')}.${dropColumn[2].toLowerCase()}` });
      continue;
    }

    const createIndex = upper.match(/^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\S+)/);
    if (createIndex) {
      operations.push({ type: 'CREATE_INDEX', object: createIndex[1].toLowerCase() });
      continue;
    }

    operations.push({ type: 'OTHER', object: line.substring(0, 80) });
  }

  return operations;
}

/**
 * Close a PR without merging.
 */
async function closePullRequest(pool, id, closedBy) {
  return updatePullRequest(pool, id, { status: 'closed', reviewed_by: closedBy });
}

/**
 * Reopen a closed PR.
 */
async function reopenPullRequest(pool, id) {
  return updatePullRequest(pool, id, { status: 'open' });
}

/**
 * Merge a PR: sandbox test must have passed, apply SQL, create migration.
 */
async function mergePullRequest(pool, project, prId, mergedBy) {
  const pr = await getPullRequest(pool, prId);
  if (!pr) throw new Error('Pull request not found');
  if (pr.status === 'merged') throw new Error('Already merged');
  if (pr.status === 'closed') throw new Error('Cannot merge a closed PR. Reopen first.');

  // Verify sandbox passed
  if (!pr.sandbox_result?.success) {
    throw new Error('Sandbox test must pass before merging. Run "Test in Sandbox" first.');
  }

  // Final conflict check
  const conflictResult = await checkConflicts(pool, project, pr);
  if (conflictResult.has_conflicts) {
    await updatePullRequest(pool, prId, { status: 'conflict', conflict_result: conflictResult });
    throw new Error(`Merge blocked: ${conflictResult.conflicts.length} conflict(s) detected. Re-test after resolving.`);
  }

  // Create migration from PR
  const migration = await syncService.createMigration(pool, {
    projectId: project.id,
    sqlUp: pr.sql_content,
    name: `pr_${pr.pr_number}_${pr.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}`,
    source: 'push',
    appliedBy: mergedBy,
  });

  // Apply migration to DB
  await syncService.pushMigration(pool, project, migration.id);

  // Update PR
  const merged = await pool.query(
    `UPDATE vpc_pull_requests SET status = 'merged', merged_by = $2, merged_at = NOW(), migration_id = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [prId, mergedBy, migration.id]
  );

  return { pr: merged.rows[0], migration };
}

module.exports = {
  createPullRequest,
  getPullRequests,
  getPullRequest,
  getPullRequestByNumber,
  updatePullRequest,
  testPullRequest,
  checkConflicts,
  closePullRequest,
  reopenPullRequest,
  mergePullRequest,
  parseDDLOperations,
};
