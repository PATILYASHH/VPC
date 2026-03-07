const crypto = require('crypto');
const pullService = require('./pullService');
const banadbService = require('./banadbService');

/**
 * List migrations for a project with pagination/filtering.
 */
async function getMigrations(pool, projectId, { page = 1, limit = 50, status } = {}) {
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
      `SELECT * FROM vpc_migrations WHERE ${where} ORDER BY version DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM vpc_migrations WHERE ${where}`, params),
  ]);

  return { migrations: rows, total: countRows[0].count, page, limit };
}

/**
 * Get a single migration by ID.
 */
async function getMigration(pool, id) {
  const { rows } = await pool.query(`SELECT * FROM vpc_migrations WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Get next migration version number for a project.
 */
async function getNextVersion(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM vpc_migrations WHERE project_id = $1`,
    [projectId]
  );
  return rows[0].next;
}

/**
 * Create a migration record from pending schema changes.
 */
async function createMigration(pool, { projectId, sqlUp, name, source = 'pull', appliedBy, changeIds }) {
  const version = await getNextVersion(pool, projectId);
  const checksum = crypto.createHash('sha256').update(sqlUp).digest('hex');
  const sqlDown = generateReverseSQL(sqlUp);

  const { rows } = await pool.query(
    `INSERT INTO vpc_migrations (project_id, version, name, sql_up, sql_down, checksum, source, applied_by, change_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [projectId, version, name || `migration_v${version}`, sqlUp, sqlDown, checksum, source, appliedBy, JSON.stringify(changeIds || [])]
  );
  return rows[0];
}

/**
 * Create migration from pending schema changes in a project.
 */
async function createMigrationFromChanges(pool, project, { sinceId = 0, appliedBy = 'vpshub' } = {}) {
  const projectPool = banadbService.getProjectPool(project);
  const { changes, latest_id } = await pullService.getSchemaChanges(projectPool, sinceId);

  if (changes.length === 0) return null;

  const sqlUp = changes
    .map(c => c.ddl_command.trim().replace(/;*$/, ';'))
    .join('\n\n');

  const changeIds = changes.map(c => c.id);
  const name = summarizeChanges(changes);

  const migration = await createMigration(pool, {
    projectId: project.id,
    sqlUp,
    name,
    source: 'pull',
    appliedBy,
    changeIds,
  });

  return { migration, latest_id, change_count: changes.length };
}

/**
 * Push (apply) a migration to the project database.
 */
async function pushMigration(pool, project, migrationId) {
  const migration = await getMigration(pool, migrationId);
  if (!migration) throw new Error('Migration not found');
  if (migration.status === 'applied') throw new Error('Migration already applied');

  const adminPool = pullService.getAdminProjectPool
    ? (() => { throw new Error('need admin pool'); })()
    : null;

  // Use the project pool with admin credentials for DDL operations
  const { Pool } = require('pg');
  const execPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 2,
    idleTimeoutMillis: 10000,
  });

  try {
    await execPool.query(migration.sql_up);
    await pool.query(
      `UPDATE vpc_migrations SET status = 'applied', applied_at = NOW() WHERE id = $1`,
      [migrationId]
    );

    // Save schema snapshot after apply
    const snapshot = await getSchemaSnapshot(execPool);
    await saveSnapshot(pool, project.id, migrationId, snapshot);

    return { ...migration, status: 'applied' };
  } catch (err) {
    await pool.query(
      `UPDATE vpc_migrations SET status = 'failed' WHERE id = $1`,
      [migrationId]
    );
    throw err;
  } finally {
    await execPool.end();
  }
}

/**
 * Rollback a migration using its sql_down.
 */
async function rollbackMigration(pool, project, migrationId) {
  const migration = await getMigration(pool, migrationId);
  if (!migration) throw new Error('Migration not found');
  if (migration.status !== 'applied') throw new Error('Can only rollback applied migrations');
  if (!migration.sql_down) throw new Error('No rollback SQL available for this migration');

  const { Pool } = require('pg');
  const execPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 2,
    idleTimeoutMillis: 10000,
  });

  try {
    await execPool.query(migration.sql_down);
    await pool.query(
      `UPDATE vpc_migrations SET status = 'rolled_back', rolled_back_at = NOW() WHERE id = $1`,
      [migrationId]
    );
    return { ...migration, status: 'rolled_back' };
  } catch (err) {
    throw new Error(`Rollback failed: ${err.message}`);
  } finally {
    await execPool.end();
  }
}

/**
 * Generate basic reverse SQL from forward SQL.
 * Handles common DDL patterns.
 */
function generateReverseSQL(sqlUp) {
  const lines = sqlUp.split(';').map(s => s.trim()).filter(Boolean);
  const reverseLines = [];

  for (const line of lines) {
    const upper = line.toUpperCase().replace(/\s+/g, ' ').trim();

    // CREATE TABLE x (...) → DROP TABLE x
    const createTable = upper.match(/^CREATE TABLE (?:IF NOT EXISTS )?(\S+)/);
    if (createTable) {
      reverseLines.push(`DROP TABLE IF EXISTS ${extractOriginalName(line, createTable[1])};`);
      continue;
    }

    // CREATE INDEX x → DROP INDEX x
    const createIndex = upper.match(/^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\S+)/);
    if (createIndex) {
      reverseLines.push(`DROP INDEX IF EXISTS ${extractOriginalName(line, createIndex[1])};`);
      continue;
    }

    // ALTER TABLE x ADD COLUMN y → ALTER TABLE x DROP COLUMN y
    const addColumn = upper.match(/^ALTER TABLE (\S+) ADD (?:COLUMN )?(\S+)/);
    if (addColumn) {
      const tableName = extractOriginalName(line, addColumn[1]);
      const colName = extractOriginalName(line, addColumn[2]);
      reverseLines.push(`ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${colName};`);
      continue;
    }

    // DROP TABLE x → comment (can't auto-reverse)
    if (upper.startsWith('DROP TABLE') || upper.startsWith('DROP INDEX')) {
      reverseLines.push(`-- Cannot auto-reverse: ${line.substring(0, 80)}...`);
      continue;
    }

    // Default: comment out as non-reversible
    reverseLines.push(`-- Manual rollback needed: ${line.substring(0, 100)}`);
  }

  return reverseLines.length > 0 ? reverseLines.reverse().join('\n') : null;
}

/**
 * Extract original-case name from SQL line.
 */
function extractOriginalName(line, upperName) {
  const regex = new RegExp(upperName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const match = line.match(regex);
  return match ? match[0] : upperName.toLowerCase();
}

/**
 * Generate a human-readable name from changes.
 */
function summarizeChanges(changes) {
  if (changes.length === 1) {
    const c = changes[0];
    return `${c.event_type.toLowerCase()}_${(c.object_type || 'object').toLowerCase()}_${(c.object_identity || '').split('.').pop()}`;
  }
  const types = [...new Set(changes.map(c => c.event_type))];
  return `${changes.length}_changes_${types.join('_').toLowerCase()}`;
}

/**
 * Get current schema snapshot from a project database.
 */
async function getSchemaSnapshot(projectPool) {
  const { rows: tables } = await projectPool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    AND table_name NOT LIKE '_vpc_%'
    ORDER BY table_name
  `);

  const snapshot = { tables: [] };

  for (const table of tables) {
    const { rows: columns } = await projectPool.query(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table.table_name]);

    const { rows: constraints } = await projectPool.query(`
      SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = $1
    `, [table.table_name]);

    const { rows: indexes } = await projectPool.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [table.table_name]);

    snapshot.tables.push({
      name: table.table_name,
      columns,
      constraints,
      indexes,
    });
  }

  return snapshot;
}

/**
 * Save a schema snapshot.
 */
async function saveSnapshot(pool, projectId, migrationId, snapshot) {
  await pool.query(
    `INSERT INTO vpc_schema_snapshots (project_id, migration_id, snapshot) VALUES ($1, $2, $3)`,
    [projectId, migrationId, JSON.stringify(snapshot)]
  );
}

/**
 * Get the latest schema snapshot for a project.
 */
async function getLatestSnapshot(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT * FROM vpc_schema_snapshots WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

module.exports = {
  getMigrations,
  getMigration,
  createMigration,
  createMigrationFromChanges,
  pushMigration,
  rollbackMigration,
  generateReverseSQL,
  getSchemaSnapshot,
  saveSnapshot,
  getLatestSnapshot,
  getNextVersion,
};
