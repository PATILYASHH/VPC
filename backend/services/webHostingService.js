const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOSTING_DIR = path.join(os.homedir(), 'web-hosting');
const RESERVED_SLUGS = ['api', 'admin', 'storage', 'uploads', 'downloads', 'health', 'web-hosting', 'sites'];
const PORT_START = 4001;

function ensureHostingDir() {
  if (!fs.existsSync(HOSTING_DIR)) {
    fs.mkdirSync(HOSTING_DIR, { recursive: true });
  }
}

function buildCloneUrl(gitUrl, gitToken) {
  if (!gitToken) return gitUrl;
  try {
    const url = new URL(gitUrl);
    url.username = gitToken;
    url.password = '';
    return url.toString();
  } catch {
    // For git@ SSH URLs, token doesn't apply
    return gitUrl;
  }
}

function runCommand(cmd, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const mergedEnv = { ...process.env, ...env };
    exec(cmd, { cwd, timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: mergedEnv }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr || ''}`));
      } else {
        resolve((stdout || '') + (stderr || ''));
      }
    });
  });
}

// --- CRUD ---

async function createProject(pool, data) {
  const { name, slug, projectType, gitUrl, gitToken, gitBranch, buildCommand, installCommand, outputDir, nodeEntryPoint, envVars, createdBy } = data;

  if (RESERVED_SLUGS.includes(slug)) {
    throw new Error(`Slug "${slug}" is reserved and cannot be used`);
  }

  const deployPath = path.join(HOSTING_DIR, slug);

  const { rows } = await pool.query(
    `INSERT INTO web_hosting_projects (name, slug, project_type, git_url, git_token, git_branch, deploy_path, build_command, install_command, output_dir, node_entry_point, env_vars, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [name, slug, projectType || 'static', gitUrl || null, gitToken || null, gitBranch || 'main', deployPath, buildCommand || null, installCommand || 'npm install', outputDir || null, nodeEntryPoint || 'index.js', JSON.stringify(envVars || {}), createdBy]
  );
  return rows[0];
}

async function getProject(pool, id) {
  const { rows } = await pool.query('SELECT * FROM web_hosting_projects WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getProjectBySlug(pool, slug) {
  const { rows } = await pool.query('SELECT * FROM web_hosting_projects WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function listProjects(pool) {
  const { rows } = await pool.query('SELECT * FROM web_hosting_projects ORDER BY created_at DESC');
  return rows;
}

async function updateProject(pool, id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const allowedFields = ['name', 'git_url', 'git_token', 'git_branch', 'build_command', 'install_command', 'output_dir', 'node_entry_point', 'env_vars', 'project_type'];

  for (const [key, value] of Object.entries(data)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(dbKey)) {
      fields.push(`${dbKey} = $${idx}`);
      values.push(dbKey === 'env_vars' ? JSON.stringify(value) : value);
      idx++;
    }
  }

  if (fields.length === 0) return getProject(pool, id);

  fields.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE web_hosting_projects SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

async function deleteProject(pool, id) {
  const project = await getProject(pool, id);
  if (!project) throw new Error('Project not found');

  // Stop PM2 process if running
  if (project.pm2_name) {
    try { await runCommand(`pm2 delete ${project.pm2_name}`, '/'); } catch {}
  }

  // Remove files
  if (project.deploy_path && fs.existsSync(project.deploy_path)) {
    fs.rmSync(project.deploy_path, { recursive: true, force: true });
  }

  await pool.query('DELETE FROM web_hosting_projects WHERE id = $1', [id]);
  return project;
}

// --- Port Management ---

async function getNextPort(pool) {
  const { rows } = await pool.query('SELECT MAX(node_port) as max_port FROM web_hosting_projects WHERE node_port IS NOT NULL');
  return (rows[0]?.max_port || PORT_START - 1) + 1;
}

// --- Deploy ---

async function deploy(pool, project) {
  ensureHostingDir();
  let log = '';

  try {
    await pool.query(`UPDATE web_hosting_projects SET status = 'deploying', updated_at = NOW() WHERE id = $1`, [project.id]);

    const cloneUrl = buildCloneUrl(project.git_url, project.git_token);
    const deployPath = project.deploy_path || path.join(HOSTING_DIR, project.slug);

    // Clone or pull
    if (fs.existsSync(path.join(deployPath, '.git'))) {
      log += '> git pull\n';
      const pullOut = await runCommand(`git pull origin ${project.git_branch || 'main'}`, deployPath);
      log += pullOut + '\n';
    } else {
      if (fs.existsSync(deployPath)) {
        fs.rmSync(deployPath, { recursive: true, force: true });
      }
      log += `> git clone -b ${project.git_branch || 'main'}\n`;
      const cloneOut = await runCommand(`git clone -b ${project.git_branch || 'main'} "${cloneUrl}" "${deployPath}"`, HOSTING_DIR);
      log += cloneOut + '\n';
    }

    // Install dependencies
    if (project.install_command) {
      const packageJson = path.join(deployPath, 'package.json');
      if (fs.existsSync(packageJson)) {
        log += `> ${project.install_command}\n`;
        const installOut = await runCommand(project.install_command, deployPath);
        log += installOut + '\n';
      }
    }

    // Build
    if (project.build_command) {
      log += `> ${project.build_command}\n`;
      const buildOut = await runCommand(project.build_command, deployPath);
      log += buildOut + '\n';
    }

    // Start Node backend if needed
    if (project.project_type === 'node' || project.project_type === 'fullstack') {
      let port = project.node_port;
      if (!port) {
        port = await getNextPort(pool);
      }
      const pm2Name = `wh-${project.slug}`;
      const entryPoint = project.node_entry_point || 'index.js';
      const entryPath = path.join(deployPath, entryPoint);

      if (!fs.existsSync(entryPath)) {
        throw new Error(`Entry point "${entryPoint}" not found at ${entryPath}`);
      }

      // Build env vars for PM2
      const envVars = project.env_vars || {};
      envVars.PORT = String(port);

      const envStr = Object.entries(envVars).map(([k, v]) => `${k}="${v}"`).join(' ');

      // Stop existing process
      try { await runCommand(`pm2 delete ${pm2Name}`, '/'); } catch {}

      log += `> Starting Node.js on port ${port}\n`;
      const startCmd = `${envStr} pm2 start "${entryPath}" --name "${pm2Name}" -- --port ${port}`;
      const startOut = await runCommand(startCmd, deployPath);
      log += startOut + '\n';

      await runCommand('pm2 save', '/');

      await pool.query(
        `UPDATE web_hosting_projects SET node_port = $1, pm2_name = $2, status = 'running', last_deploy_at = NOW(), last_deploy_log = $3, updated_at = NOW() WHERE id = $4`,
        [port, pm2Name, log, project.id]
      );
    } else {
      await pool.query(
        `UPDATE web_hosting_projects SET status = 'running', last_deploy_at = NOW(), last_deploy_log = $1, updated_at = NOW() WHERE id = $2`,
        [log, project.id]
      );
    }

    return { success: true, log };
  } catch (err) {
    log += `\nERROR: ${err.message}\n`;
    await pool.query(
      `UPDATE web_hosting_projects SET status = 'error', last_deploy_at = NOW(), last_deploy_log = $1, updated_at = NOW() WHERE id = $2`,
      [log, project.id]
    );
    throw new Error(log);
  }
}

async function redeploy(pool, projectId) {
  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');
  return deploy(pool, project);
}

// --- PM2 Controls ---

async function startBackend(pool, project) {
  if (!project.pm2_name) throw new Error('No PM2 process configured. Deploy first.');
  await runCommand(`pm2 start ${project.pm2_name}`, '/');
  await pool.query(`UPDATE web_hosting_projects SET status = 'running', updated_at = NOW() WHERE id = $1`, [project.id]);
}

async function stopBackend(pool, project) {
  if (!project.pm2_name) throw new Error('No PM2 process configured');
  await runCommand(`pm2 stop ${project.pm2_name}`, '/');
  await pool.query(`UPDATE web_hosting_projects SET status = 'stopped', updated_at = NOW() WHERE id = $1`, [project.id]);
}

async function restartBackend(pool, project) {
  if (!project.pm2_name) throw new Error('No PM2 process configured');
  await runCommand(`pm2 restart ${project.pm2_name}`, '/');
  await pool.query(`UPDATE web_hosting_projects SET status = 'running', updated_at = NOW() WHERE id = $1`, [project.id]);
}

async function getLogs(project, lines = 100) {
  if (!project.pm2_name) return { out: '', err: '' };
  try {
    const out = await runCommand(`pm2 logs ${project.pm2_name} --nostream --lines ${lines}`, '/');
    return { combined: out };
  } catch (err) {
    return { combined: err.message };
  }
}

async function getStatus(project) {
  if (!project.pm2_name) return { status: 'not_deployed' };
  try {
    const out = await runCommand(`pm2 jlist`, '/');
    const processes = JSON.parse(out);
    const proc = processes.find(p => p.name === project.pm2_name);
    if (!proc) return { status: 'not_found' };
    return {
      status: proc.pm2_env.status,
      cpu: proc.monit?.cpu,
      memory: proc.monit?.memory,
      uptime: proc.pm2_env.pm_uptime,
      restarts: proc.pm2_env.restart_time,
    };
  } catch {
    return { status: 'unknown' };
  }
}

// --- Slug cache for public serving ---
let slugCache = {};

async function refreshSlugCache(pool) {
  try {
    const { rows } = await pool.query(`SELECT slug, project_type, deploy_path, output_dir, node_port, status FROM web_hosting_projects WHERE status != 'stopped'`);
    const cache = {};
    for (const row of rows) {
      cache[row.slug] = row;
    }
    slugCache = cache;
  } catch {}
}

function getSlugCache() {
  return slugCache;
}

module.exports = {
  createProject, getProject, getProjectBySlug, listProjects, updateProject, deleteProject,
  deploy, redeploy, startBackend, stopBackend, restartBackend, getLogs, getStatus, getNextPort,
  refreshSlugCache, getSlugCache, RESERVED_SLUGS, HOSTING_DIR, ensureHostingDir
};
