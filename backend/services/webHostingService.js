const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns').promises;

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

// Bug #3: Prepend node_modules/.bin dirs to PATH so build tools (vite, react-scripts, craco) are found
function runCommand(cmd, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    // Build PATH with node_modules/.bin from cwd and parent dirs
    const pathSep = ':';
    const extraPaths = [];
    if (cwd) {
      let dir = cwd;
      for (let i = 0; i < 5; i++) {
        const binDir = path.join(dir, 'node_modules', '.bin');
        if (fs.existsSync(binDir)) {
          extraPaths.push(binDir);
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    const existingPath = process.env.PATH || '';
    const newPath = extraPaths.length > 0 ? extraPaths.join(pathSep) + pathSep + existingPath : existingPath;

    const mergedEnv = { ...process.env, ...env, PATH: newPath };
    exec(cmd, { cwd, timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: mergedEnv }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${err.message}\n${stderr || ''}`));
      } else {
        resolve((stdout || '') + (stderr || ''));
      }
    });
  });
}

// Bug #3 helper: chmod +x all node_modules/.bin files after install
function chmodBinDirs(deployPath) {
  const dirsToCheck = [deployPath];
  // Also check common subdirectories
  const subDirs = ['frontend', 'client', 'web', 'app', 'backend', 'server', 'api'];
  for (const sub of subDirs) {
    const subDir = path.join(deployPath, sub);
    if (fs.existsSync(subDir)) dirsToCheck.push(subDir);
  }
  for (const dir of dirsToCheck) {
    const binDir = path.join(dir, 'node_modules', '.bin');
    if (fs.existsSync(binDir)) {
      try {
        const files = fs.readdirSync(binDir);
        for (const f of files) {
          try { fs.chmodSync(path.join(binDir, f), 0o755); } catch {}
        }
      } catch {}
    }
  }
}

// Bug #4: Write env vars to .env file(s) in deploy directory
function writeEnvFile(deployPath, envVars) {
  if (!envVars || Object.keys(envVars).length === 0) return;
  const envContent = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';

  // Write to root deploy dir
  fs.writeFileSync(path.join(deployPath, '.env'), envContent);

  // Also write to backend subdirectory if one exists
  const backendDirs = ['backend', 'server', 'api'];
  for (const dir of backendDirs) {
    const subDir = path.join(deployPath, dir);
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      fs.writeFileSync(path.join(subDir, '.env'), envContent);
    }
  }
}

// Bug #5: Generate PM2 ecosystem config file
function writeEcosystemConfig(deployPath, pm2Name, entryPath, envVars, cwd) {
  const config = {
    apps: [{
      name: pm2Name,
      script: entryPath,
      cwd: cwd || deployPath,
      env: envVars,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 1000,
    }]
  };
  const filePath = path.join(deployPath, 'ecosystem.wh.config.js');
  fs.writeFileSync(filePath, `module.exports = ${JSON.stringify(config, null, 2)};\n`);
  return filePath;
}

// Bug #6: Auto-detect project structure
function detectProjectStructure(deployPath, slug) {
  const detected = {
    frontendDir: null,
    backendDir: null,
    framework: null,
    installCommand: null,
    buildCommand: null,
    outputDir: null,
    nodeEntryPoint: null,
    projectType: null,
  };

  // Detect frontend directory
  const frontendCandidates = ['frontend', 'client', 'web', 'app'];
  for (const dir of frontendCandidates) {
    const fullPath = path.join(deployPath, dir);
    if (fs.existsSync(path.join(fullPath, 'package.json'))) {
      detected.frontendDir = dir;
      break;
    }
  }

  // Detect backend directory
  const backendCandidates = ['backend', 'server', 'api'];
  for (const dir of backendCandidates) {
    const fullPath = path.join(deployPath, dir);
    if (fs.existsSync(path.join(fullPath, 'package.json'))) {
      detected.backendDir = dir;
      break;
    }
  }

  // Determine where to look for framework config
  const frontendBase = detected.frontendDir ? path.join(deployPath, detected.frontendDir) : deployPath;
  const backendBase = detected.backendDir ? path.join(deployPath, detected.backendDir) : deployPath;

  // Detect framework from frontend dir
  const viteConfigs = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.mts'];
  const cracoConfigs = ['craco.config.js', 'craco.config.ts'];
  const nextConfigs = ['next.config.js', 'next.config.ts', 'next.config.mjs'];

  if (viteConfigs.some(c => fs.existsSync(path.join(frontendBase, c)))) {
    detected.framework = 'vite';
  } else if (nextConfigs.some(c => fs.existsSync(path.join(frontendBase, c)))) {
    detected.framework = 'next';
  } else if (cracoConfigs.some(c => fs.existsSync(path.join(frontendBase, c)))) {
    detected.framework = 'craco';
  } else {
    // Check for react-scripts in dependencies
    try {
      const pkgPath = path.join(frontendBase, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.dependencies?.['react-scripts'] || pkg.devDependencies?.['react-scripts']) {
          detected.framework = 'cra';
        }
      }
    } catch {}
  }

  // Detect output directory based on framework
  if (detected.framework === 'vite') {
    detected.outputDir = detected.frontendDir ? `${detected.frontendDir}/dist` : 'dist';
  } else if (detected.framework === 'cra' || detected.framework === 'craco') {
    detected.outputDir = detected.frontendDir ? `${detected.frontendDir}/build` : 'build';
  } else if (detected.framework === 'next') {
    detected.outputDir = detected.frontendDir ? `${detected.frontendDir}/.next` : '.next';
  }

  // Detect node entry point from backend dir
  const entryPointCandidates = ['server.js', 'index.js', 'app.js', 'src/index.js', 'src/server.js', 'src/app.js'];
  const entrySearchBase = detected.backendDir ? backendBase : deployPath;
  for (const entry of entryPointCandidates) {
    if (fs.existsSync(path.join(entrySearchBase, entry))) {
      detected.nodeEntryPoint = detected.backendDir ? `${detected.backendDir}/${entry}` : entry;
      break;
    }
  }
  // Also check main field in package.json
  if (!detected.nodeEntryPoint) {
    try {
      const pkgPath = path.join(entrySearchBase, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.main) {
          const mainPath = detected.backendDir ? `${detected.backendDir}/${pkg.main}` : pkg.main;
          if (fs.existsSync(path.join(deployPath, mainPath))) {
            detected.nodeEntryPoint = mainPath;
          }
        }
      }
    } catch {}
  }

  // Determine project type
  const hasFrontend = detected.frontendDir || detected.framework;
  const hasBackend = detected.backendDir || detected.nodeEntryPoint;
  if (hasFrontend && hasBackend) {
    detected.projectType = 'fullstack';
  } else if (hasBackend && !hasFrontend) {
    detected.projectType = 'node';
  } else {
    detected.projectType = 'static';
  }

  // Build install command
  const isMonorepo = detected.frontendDir && detected.backendDir;
  if (isMonorepo) {
    const parts = [];
    parts.push(`cd ${detected.frontendDir} && npm install`);
    parts.push(`cd ${detected.backendDir} && npm install`);
    detected.installCommand = parts.join(' && cd .. && ');
  } else if (detected.frontendDir && !detected.backendDir) {
    detected.installCommand = `cd ${detected.frontendDir} && npm install`;
  } else if (detected.backendDir && !detected.frontendDir) {
    detected.installCommand = `cd ${detected.backendDir} && npm install`;
  } else {
    // Single directory project - check if root has package.json
    if (fs.existsSync(path.join(deployPath, 'package.json'))) {
      detected.installCommand = 'npm install';
    }
  }

  // Build build command
  if (detected.framework === 'vite') {
    const cdPrefix = detected.frontendDir ? `cd ${detected.frontendDir} && ` : '';
    detected.buildCommand = `${cdPrefix}node node_modules/vite/bin/vite.js build --base=/${slug}/`;
  } else if (detected.framework === 'cra') {
    const cdPrefix = detected.frontendDir ? `cd ${detected.frontendDir} && ` : '';
    detected.buildCommand = `${cdPrefix}PUBLIC_URL=/${slug} npm run build`;
  } else if (detected.framework === 'craco') {
    const cdPrefix = detected.frontendDir ? `cd ${detected.frontendDir} && ` : '';
    detected.buildCommand = `${cdPrefix}PUBLIC_URL=/${slug} npm run build`;
  } else if (detected.framework === 'next') {
    const cdPrefix = detected.frontendDir ? `cd ${detected.frontendDir} && ` : '';
    detected.buildCommand = `${cdPrefix}npm run build`;
  }

  return detected;
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

  const allowedFields = ['name', 'git_url', 'git_token', 'git_branch', 'build_command', 'install_command', 'output_dir', 'node_entry_point', 'env_vars', 'project_type', 'custom_domain'];

  for (const [key, value] of Object.entries(data)) {
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (allowedFields.includes(dbKey)) {
      fields.push(`${dbKey} = $${idx}`);
      values.push(dbKey === 'env_vars' ? JSON.stringify(value) : value);
      idx++;
    }
  }

  if (fields.length === 0) return getProject(pool, id);

  // Reset verification when custom_domain changes
  if (fields.some(f => f.startsWith('custom_domain'))) {
    fields.push(`domain_verified = FALSE`);
    fields.push(`domain_verify_token = NULL`);
  }

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

// --- Domain Verification ---

async function generateDomainVerifyToken(pool, projectId) {
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await pool.query(
    `UPDATE web_hosting_projects SET domain_verify_token = $1, domain_verified = FALSE, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [token, projectId]
  );
  return rows[0];
}

async function verifyDomain(pool, projectId) {
  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');
  if (!project.custom_domain) throw new Error('No custom domain configured');
  if (!project.domain_verify_token) throw new Error('No verification token. Generate one first.');

  const txtHost = `_vpc-verify.${project.custom_domain}`;
  let records;
  try {
    records = await dns.resolveTxt(txtHost);
  } catch {
    throw new Error(`Could not resolve TXT record for ${txtHost}. Make sure the record exists and DNS has propagated.`);
  }

  const flat = records.flat();
  const found = flat.some(r => r === project.domain_verify_token);

  if (!found) {
    throw new Error('Verification TXT record not found or does not match. Check the record value and wait for DNS propagation.');
  }

  const { rows } = await pool.query(
    `UPDATE web_hosting_projects SET domain_verified = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [projectId]
  );
  return rows[0];
}

async function removeDomain(pool, projectId) {
  const { rows } = await pool.query(
    `UPDATE web_hosting_projects SET custom_domain = NULL, domain_verify_token = NULL, domain_verified = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [projectId]
  );
  return rows[0];
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
      // Bug #1: Reset tracked files before pull to avoid "local changes would be overwritten"
      // Preserve .env and ecosystem.wh.config.js (our generated files)
      log += '> git checkout -- . && git clean -fd -e .env -e ecosystem.wh.config.js\n';
      try {
        await runCommand('git checkout -- .', deployPath);
        await runCommand('git clean -fd -e .env -e ecosystem.wh.config.js', deployPath);
      } catch (cleanErr) {
        log += `Warning: git clean failed: ${cleanErr.message}\n`;
      }

      log += `> git pull origin ${project.git_branch || 'main'}\n`;
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

    // Bug #6: Auto-detect project structure and fill empty fields
    const detected = detectProjectStructure(deployPath, project.slug);
    log += `> Auto-detected: framework=${detected.framework || 'none'}, frontendDir=${detected.frontendDir || 'none'}, backendDir=${detected.backendDir || 'none'}, type=${detected.projectType}\n`;

    const updates = {};
    if ((!project.install_command || project.install_command === 'npm install') && detected.installCommand && detected.installCommand !== 'npm install') {
      updates.install_command = detected.installCommand;
      log += `> Auto-set install command: ${detected.installCommand}\n`;
    }
    if (!project.build_command && detected.buildCommand) {
      updates.build_command = detected.buildCommand;
      log += `> Auto-set build command: ${detected.buildCommand}\n`;
    }
    if (!project.output_dir && detected.outputDir) {
      updates.output_dir = detected.outputDir;
      log += `> Auto-set output dir: ${detected.outputDir}\n`;
    }
    if ((!project.node_entry_point || project.node_entry_point === 'index.js') && detected.nodeEntryPoint && detected.nodeEntryPoint !== 'index.js') {
      updates.node_entry_point = detected.nodeEntryPoint;
      log += `> Auto-set entry point: ${detected.nodeEntryPoint}\n`;
    }
    if (project.project_type === 'static' && detected.projectType !== 'static') {
      updates.project_type = detected.projectType;
      log += `> Auto-set project type: ${detected.projectType}\n`;
    }

    // Persist auto-detected values to DB
    if (Object.keys(updates).length > 0) {
      const setClauses = [];
      const vals = [];
      let paramIdx = 1;
      for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = $${paramIdx}`);
        vals.push(value);
        paramIdx++;
      }
      setClauses.push('updated_at = NOW()');
      vals.push(project.id);
      await pool.query(`UPDATE web_hosting_projects SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`, vals);

      // Merge updates into project for remainder of deploy
      Object.assign(project, updates);
    }

    // Bug #4: Write .env file(s) before install/build
    const envVars = project.env_vars || {};
    writeEnvFile(deployPath, envVars);
    if (Object.keys(envVars).length > 0) {
      log += `> Wrote .env file (${Object.keys(envVars).length} vars)\n`;
    }

    // Install dependencies
    // Bug #2: Always run install command if set — don't gate on root package.json
    if (project.install_command) {
      log += `> ${project.install_command}\n`;
      const installOut = await runCommand(project.install_command, deployPath);
      log += installOut + '\n';

      // Bug #3: chmod +x node_modules/.bin after install
      chmodBinDirs(deployPath);
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
      const pm2Env = { ...(project.env_vars || {}), PORT: String(port) };

      // Stop existing process
      try { await runCommand(`pm2 delete ${pm2Name}`, '/'); } catch {}

      // Bug #5: Use ecosystem config file instead of fragile shell env prefix
      const entryDir = path.dirname(entryPath);
      const ecosystemPath = writeEcosystemConfig(deployPath, pm2Name, entryPath, pm2Env, entryDir);
      log += `> Generated PM2 ecosystem config\n`;

      log += `> Starting Node.js on port ${port}\n`;
      const startCmd = `pm2 start "${ecosystemPath}"`;
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

    // Bug #7: Refresh slug cache inside deploy() so it's not stale
    await refreshSlugCache(pool);
    await refreshDomainCache(pool);

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

// --- Custom domain cache for public serving ---
let domainCache = {};

async function refreshDomainCache(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT slug, custom_domain, project_type, deploy_path, output_dir, node_port, status
       FROM web_hosting_projects
       WHERE status != 'stopped' AND custom_domain IS NOT NULL AND custom_domain != ''`
    );
    const cache = {};
    for (const row of rows) {
      cache[row.custom_domain] = row;
    }
    domainCache = cache;
  } catch {}
}

function getDomainCache() {
  return domainCache;
}

async function getProjectByDomain(pool, domain) {
  const { rows } = await pool.query(
    `SELECT * FROM web_hosting_projects WHERE custom_domain = $1`,
    [domain]
  );
  return rows[0] || null;
}

module.exports = {
  createProject, getProject, getProjectBySlug, listProjects, updateProject, deleteProject,
  deploy, redeploy, startBackend, stopBackend, restartBackend, getLogs, getStatus, getNextPort,
  refreshSlugCache, getSlugCache, refreshDomainCache, getDomainCache, getProjectByDomain,
  generateDomainVerifyToken, verifyDomain, removeDomain,
  detectProjectStructure, buildCloneUrl,
  RESERVED_SLUGS, HOSTING_DIR, ensureHostingDir
};
