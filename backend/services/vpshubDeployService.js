const gitService = require('./vpshubGitService');
const dbService = require('./dbService');
const webHostingService = require('./webHostingService');
const tgBot = require('./jarvisTelegramService');

// ─── Link/Unlink Repo to DB Project ──────────────────────

async function linkRepoToProject(pool, repoId, projectId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_repositories SET linked_project_id = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [projectId, repoId]
  );
  return rows[0];
}

async function unlinkRepo(pool, repoId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_repositories SET linked_project_id = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [repoId]
  );
  return rows[0];
}

// ─── Detect Migrations in Repo ��──────────────────────────────

async function detectMigrations(ownerUsername, repoSlug, ref) {
  try {
    const manifest = await gitService.getFileManifest(ownerUsername, repoSlug, ref);
    // Find SQL files in migrations/ or migration/ folders
    const migrations = manifest.filter(f =>
      /^migrations?\/.+\.sql$/i.test(f.path)
    ).sort((a, b) => a.path.localeCompare(b.path));
    return migrations;
  } catch {
    return [];
  }
}

// ─── Get Applied Migrations Status ───────────────────────────

async function getMigrationStatus(pool, repoId, projectId) {
  const { rows } = await pool.query(
    `SELECT file_path, file_hash, status, error_message, applied_at
     FROM vpshub_repo_migrations
     WHERE repo_id = $1 AND project_id = $2
     ORDER BY file_path`,
    [repoId, projectId]
  );
  return rows;
}

// ─── Run a Single Migration ──────────────────────────────────

async function runMigration(pool, { repoId, projectId, ownerUsername, repoSlug, ref, filePath, fileHash }) {
  // Check if already applied with same hash
  const { rows: existing } = await pool.query(
    `SELECT id, status, file_hash FROM vpshub_repo_migrations
     WHERE repo_id = $1 AND project_id = $2 AND file_path = $3`,
    [repoId, projectId, filePath]
  );

  if (existing.length > 0 && existing[0].status === 'applied' && existing[0].file_hash === fileHash) {
    return { status: 'skipped', message: 'Already applied' };
  }

  // Get SQL content from git
  const sql = await gitService.getBlob(ownerUsername, repoSlug, ref, filePath);
  if (!sql) {
    return { status: 'failed', message: 'File not found in repository' };
  }

  // Get project DB pool
  const project = await getProject(pool, projectId);
  if (!project) {
    return { status: 'failed', message: 'Linked project not found' };
  }

  let projectPool;
  try {
    projectPool = await dbService.getProjectAdminPool(project);
  } catch (err) {
    return { status: 'failed', message: `Cannot connect to project DB: ${err.message}` };
  }

  // Execute SQL
  try {
    await projectPool.query(sql);

    // Record success
    if (existing.length > 0) {
      await pool.query(
        `UPDATE vpshub_repo_migrations
         SET status = 'applied', file_hash = $1, error_message = NULL, applied_at = NOW()
         WHERE id = $2`,
        [fileHash, existing[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO vpshub_repo_migrations (repo_id, project_id, file_path, file_hash, status, applied_at)
         VALUES ($1, $2, $3, $4, 'applied', NOW())`,
        [repoId, projectId, filePath, fileHash]
      );
    }

    return { status: 'applied', message: 'Migration applied successfully' };
  } catch (err) {
    // Record failure
    const errorMsg = err.message.substring(0, 1000);
    if (existing.length > 0) {
      await pool.query(
        `UPDATE vpshub_repo_migrations
         SET status = 'failed', file_hash = $1, error_message = $2
         WHERE id = $3`,
        [fileHash, errorMsg, existing[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO vpshub_repo_migrations (repo_id, project_id, file_path, file_hash, status, error_message)
         VALUES ($1, $2, $3, $4, 'failed', $5)`,
        [repoId, projectId, filePath, fileHash, errorMsg]
      );
    }

    return { status: 'failed', message: errorMsg };
  }
}

// ─── Run All Pending Migrations ──────────────────────────────

async function runAllMigrations(pool, { repoId, projectId, ownerUsername, repoSlug, ref }) {
  const migrations = await detectMigrations(ownerUsername, repoSlug, ref);
  const applied = await getMigrationStatus(pool, repoId, projectId);
  const appliedMap = new Map(applied.map(a => [a.file_path, a]));

  const results = [];
  for (const file of migrations) {
    const prev = appliedMap.get(file.path);
    // Skip if already applied with same hash
    if (prev && prev.status === 'applied' && prev.file_hash === file.hash) {
      results.push({ path: file.path, status: 'skipped', message: 'Already applied' });
      continue;
    }

    const result = await runMigration(pool, {
      repoId, projectId, ownerUsername, repoSlug, ref,
      filePath: file.path, fileHash: file.hash,
    });
    results.push({ path: file.path, ...result });

    // Stop on first failure
    if (result.status === 'failed') break;
  }

  return results;
}

// ─── Auto-deploy on Push ─────────────────────────────────────

async function onPush(pool, ownerUsername, repoSlug) {
  const repo = await gitService.getRepositoryBySlug(pool, ownerUsername, repoSlug);
  if (!repo) return null;

  const results = { migrations: null, hosting: null };
  const defaultBranch = await gitService.getDefaultBranch(ownerUsername, repoSlug);

  // Auto-run migrations if DB linked
  if (repo.linked_project_id) {
    results.migrations = await runAllMigrations(pool, {
      repoId: repo.id,
      projectId: repo.linked_project_id,
      ownerUsername, repoSlug,
      ref: defaultBranch,
    });
  }

  // Auto-redeploy hosting if linked
  if (repo.linked_hosting_id) {
    try {
      results.hosting = await redeployHosting(pool, repo.linked_hosting_id);
    } catch (err) {
      results.hosting = { success: false, error: err.message };
    }
  }

  return results;
}

// ─── Hosting Integration ─────────────────────────────────────

async function linkRepoToHosting(pool, repoId, hostingId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_repositories SET linked_hosting_id = $1, updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [hostingId, repoId]
  );
  return rows[0];
}

async function unlinkHosting(pool, repoId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_repositories SET linked_hosting_id = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [repoId]
  );
  return rows[0];
}

async function createHostingFromRepo(pool, { repoId, ownerUsername, repoSlug, name, slug, projectType, buildCommand, installCommand, outputDir, nodeEntryPoint, envVars, gitBranch, createdBy }) {
  // Build internal git URL pointing to the bare repo
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);

  const project = await webHostingService.createProject(pool, {
    name: name || repoSlug,
    slug: slug || repoSlug,
    projectType: projectType || 'static',
    gitUrl: repoPath,  // local bare repo path
    gitToken: '',
    gitBranch: gitBranch || 'main',
    buildCommand, installCommand, outputDir, nodeEntryPoint,
    envVars: envVars || {},
    createdBy,
  });

  // Link repo to this hosting project
  await linkRepoToHosting(pool, repoId, project.id);

  return project;
}

async function deployHosting(pool, hostingId) {
  const project = await webHostingService.getProject(pool, hostingId);
  if (!project) throw new Error('Hosting project not found');

  try {
    await webHostingService.deploy(pool, project);
    tgBot.alertDeploySuccess(project.name || project.slug).catch(() => {});
  } catch (err) {
    tgBot.alertDeployFailed(project.name || project.slug, err.message).catch(() => {});
    throw err;
  }
  const updated = await webHostingService.getProject(pool, hostingId);
  return updated;
}

async function redeployHosting(pool, hostingId) {
  const project = await webHostingService.getProject(pool, hostingId);
  if (!project) return { success: false, error: 'Hosting project not found' };

  try {
    await webHostingService.deploy(pool, project);
    tgBot.alertDeploySuccess(project.name || project.slug).catch(() => {});
    return { success: true };
  } catch (err) {
    tgBot.alertDeployFailed(project.name || project.slug, err.message).catch(() => {});
    return { success: false, error: err.message };
  }
}

async function getHostingStatus(pool, hostingId) {
  const project = await webHostingService.getProject(pool, hostingId);
  if (!project) return null;

  let processStatus = null;
  if (project.project_type !== 'static' && project.pm2_name) {
    try {
      processStatus = await webHostingService.getStatus(project);
    } catch { /* ignore */ }
  }

  return { project, processStatus };
}

async function getHostingLogs(pool, hostingId, lines = 100) {
  const project = await webHostingService.getProject(pool, hostingId);
  if (!project) return { logs: '', deployLog: '' };

  let pmLogs = '';
  if (project.pm2_name) {
    try {
      pmLogs = await webHostingService.getLogs(project, lines);
    } catch { /* ignore */ }
  }

  return { logs: pmLogs, deployLog: project.last_deploy_log || '' };
}

async function listHostingProjects(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, project_type, status, git_url, last_deploy_at, node_port
     FROM web_hosting_projects
     ORDER BY name`
  );
  return rows;
}

async function getLinkedHosting(pool, repoId) {
  const { rows } = await pool.query(
    `SELECT h.id, h.name, h.slug, h.project_type, h.status, h.node_port,
            h.last_deploy_at, h.last_deploy_log, h.git_branch,
            h.build_command, h.install_command, h.output_dir, h.node_entry_point
     FROM web_hosting_projects h
     JOIN vpshub_repositories r ON r.linked_hosting_id = h.id
     WHERE r.id = $1`,
    [repoId]
  );
  return rows[0] || null;
}

// ─── Helper ──────────────────────────────────────────────────

async function getProject(pool, projectId) {
  const { rows } = await pool.query(
    'SELECT * FROM db_projects WHERE id = $1 AND status = $2',
    [projectId, 'active']
  );
  return rows[0] || null;
}

async function listProjects(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, slug, db_name, status, created_at
     FROM db_projects WHERE status = 'active'
     ORDER BY name`
  );
  return rows;
}

async function getLinkedProject(pool, repoId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.slug, p.db_name, p.status, p.created_at
     FROM db_projects p
     JOIN vpshub_repositories r ON r.linked_project_id = p.id
     WHERE r.id = $1 AND p.status = 'active'`,
    [repoId]
  );
  return rows[0] || null;
}

module.exports = {
  linkRepoToProject,
  unlinkRepo,
  detectMigrations,
  getMigrationStatus,
  runMigration,
  runAllMigrations,
  onPush,
  listProjects,
  getLinkedProject,
  // Hosting
  linkRepoToHosting,
  unlinkHosting,
  createHostingFromRepo,
  deployHosting,
  redeployHosting,
  getHostingStatus,
  getHostingLogs,
  listHostingProjects,
  getLinkedHosting,
};
