const { execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns').promises;
const vcsCore = require('./vpcVcsCore');

const HOSTING_DIR = path.join(os.homedir(), 'web-hosting');
const RESERVED_SLUGS = ['api', 'admin', 'storage', 'uploads', 'downloads', 'health', 'web-hosting', 'sites'];
const PORT_START = 4001;

function ensureHostingDir() {
  if (!fs.existsSync(HOSTING_DIR)) {
    fs.mkdirSync(HOSTING_DIR, { recursive: true });
  }
}

/**
 * Check if a git_url points to a local VPC VCS repo (.vpc)
 */
function isVpcRepo(gitUrl) {
  return gitUrl && gitUrl.endsWith('.vpc') && fs.existsSync(gitUrl);
}

/**
 * Checkout a VPC VCS repo to a deploy path by reading objects directly.
 * Used instead of git clone for .vpc repos (which use SHA-256 and aren't git-compatible).
 */
function checkoutVpcRepo(repoPath, deployPath, branch) {
  const branchRef = `refs/heads/${branch}`;
  const commitHash = vcsCore.resolveRef(repoPath, branchRef);
  if (!commitHash) {
    throw new Error(`Branch '${branch}' not found in VPC repo`);
  }

  const commit = vcsCore.readCommit(repoPath, commitHash);
  const files = vcsCore.walkTree(repoPath, commit.tree);

  if (!fs.existsSync(deployPath)) {
    fs.mkdirSync(deployPath, { recursive: true });
  }

  for (const file of files) {
    // Normalize backslashes (repos pushed from Windows may have them)
    const normalizedPath = file.path.replace(/\\/g, '/');
    const filePath = path.join(deployPath, normalizedPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = vcsCore.readBlob(repoPath, file.hash);
    fs.writeFileSync(filePath, content);
    if (file.mode === '100755') {
      fs.chmodSync(filePath, 0o755);
    }
  }

  // Store a metadata file so we know the current commit for future pulls
  fs.writeFileSync(path.join(deployPath, '.vpc-deploy'), JSON.stringify({
    repoPath,
    branch,
    commitHash,
  }));

  return { commitHash, fileCount: files.length };
}

/**
 * Pull updates from a VPC VCS repo by re-checking out all files.
 */
function pullVpcRepo(repoPath, deployPath, branch) {
  const branchRef = `refs/heads/${branch}`;
  const commitHash = vcsCore.resolveRef(repoPath, branchRef);
  if (!commitHash) {
    throw new Error(`Branch '${branch}' not found in VPC repo`);
  }

  // Check if already at this commit
  const metaPath = path.join(deployPath, '.vpc-deploy');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.commitHash === commitHash) {
        return { commitHash, fileCount: 0, upToDate: true };
      }
    } catch { /* ignore corrupt meta */ }
  }

  const commit = vcsCore.readCommit(repoPath, commitHash);
  const files = vcsCore.walkTree(repoPath, commit.tree);

  // Get list of existing files to clean up removed ones
  const existingFiles = new Set();
  function collectFiles(dir, base) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.vpc-deploy' || entry.name === '.env' || entry.name === 'ecosystem.wh.config.js' || entry.name === 'node_modules') continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collectFiles(path.join(dir, entry.name), rel);
      } else {
        existingFiles.add(rel);
      }
    }
  }
  collectFiles(deployPath, '');

  // Write all files from the new commit
  const newFiles = new Set();
  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/');
    newFiles.add(normalizedPath);
    const filePath = path.join(deployPath, normalizedPath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = vcsCore.readBlob(repoPath, file.hash);
    fs.writeFileSync(filePath, content);
    if (file.mode === '100755') {
      fs.chmodSync(filePath, 0o755);
    }
  }

  // Remove files that no longer exist in the repo
  for (const oldFile of existingFiles) {
    if (!newFiles.has(oldFile)) {
      const oldPath = path.join(deployPath, oldFile);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }

  // Update metadata
  fs.writeFileSync(metaPath, JSON.stringify({ repoPath, branch, commitHash }));

  return { commitHash, fileCount: files.length, upToDate: false };
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
        // Include stdout in error — build tools (Next.js, tsc) often write errors to stdout
        const output = [stdout, stderr].filter(Boolean).join('\n');
        reject(new Error(`${err.message}\n${output}`));
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
  const subDirs = ['frontend', 'client', 'web', 'app', 'dashboard', 'backend', 'server', 'api'];
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

  // Also write to backend and frontend subdirectories if they exist
  // Frontend dirs need .env for NEXT_PUBLIC_* vars to be inlined at build time
  const subDirs = ['backend', 'server', 'api', 'frontend', 'client', 'web', 'app', 'dashboard'];
  for (const dir of subDirs) {
    const subDir = path.join(deployPath, dir);
    if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      fs.writeFileSync(path.join(subDir, '.env'), envContent);
    }
  }
}

// Patch Next.js config to add basePath for slug-based hosting
function patchNextConfigForSlug(deployPath, slug, detected) {
  const frontendDir = detected.frontendDir;
  const base = frontendDir ? path.join(deployPath, frontendDir) : deployPath;
  const configFiles = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.mts'];

  for (const configFile of configFiles) {
    const configPath = path.join(base, configFile);
    if (!fs.existsSync(configPath)) continue;

    let content;
    try { content = fs.readFileSync(configPath, 'utf8'); } catch { continue; }

    // Skip if basePath already set
    if (content.includes('basePath')) continue;

    // Insert basePath into the config object
    // Handle: const nextConfig: NextConfig = { ... }
    // or: const nextConfig = { ... }
    // or: module.exports = { ... }
    // or: export default { ... }
    let newContent = content;

    // Match common patterns for the config object opening
    // Pattern 1: NextConfig = { /* ... */ }
    newContent = newContent.replace(
      /(NextConfig\s*=\s*\{)/,
      `$1\n  basePath: '/${slug}',`
    );

    // Pattern 2: module.exports = { (JS)
    if (newContent === content) {
      newContent = newContent.replace(
        /(module\.exports\s*=\s*\{)/,
        `$1\n  basePath: '/${slug}',`
      );
    }

    // Pattern 3: export default { (ESM without type)
    if (newContent === content) {
      newContent = newContent.replace(
        /(export\s+default\s*\{)/,
        `$1\n  basePath: '/${slug}',`
      );
    }

    if (newContent !== content) {
      fs.writeFileSync(configPath, newContent, 'utf8');
      return 1;
    }
  }
  return 0;
}

// Auto-patch frontend source files so SPA works under /{slug}/ subdirectory
// Handles: BrowserRouter basename, API base URLs, login redirects
function patchFrontendForSlug(deployPath, slug, detected) {
  const frontendDir = detected.frontendDir;
  const srcDir = frontendDir
    ? path.join(deployPath, frontendDir, 'src')
    : path.join(deployPath, 'src');

  // Patch Next.js basePath if applicable
  let patchCount = 0;
  if (detected.framework === 'next') {
    patchCount += patchNextConfigForSlug(deployPath, slug, detected);
  }

  if (!fs.existsSync(srcDir)) return patchCount;

  // Recursively find all .js, .jsx, .ts, .tsx files
  const files = findSourceFiles(srcDir);

  for (const filePath of files) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch { continue; }
    let modified = false;
    let newContent = content;

    // 1. Patch BrowserRouter without basename → add basename="/{slug}"
    // Matches: <BrowserRouter> but NOT <BrowserRouter basename=
    newContent = newContent.replace(
      /(<BrowserRouter)(?!\s+basename)([\s>])/g,
      `$1 basename="/${slug}"$2`
    );

    // 2. Patch common API base patterns
    // const BASE = '/api' → const BASE = '/{slug}/api'
    newContent = newContent.replace(
      /const\s+BASE\s*=\s*['"]\/api['"]/g,
      `const BASE = '/${slug}/api'`
    );
    // baseURL: '/api' → baseURL: '/{slug}/api'
    newContent = newContent.replace(
      /baseURL:\s*['"]\/api['"]/g,
      `baseURL: '/${slug}/api'`
    );
    // axios.defaults.baseURL = '/api' or ""
    newContent = newContent.replace(
      /axios\.defaults\.baseURL\s*=\s*['"]\/api['"]/g,
      `axios.defaults.baseURL = '/${slug}/api'`
    );

    // 3. Patch login redirect paths
    // window.location.href = '/login' → '/{slug}/login'
    newContent = newContent.replace(
      /window\.location\.href\s*=\s*['"]\/login['"]/g,
      `window.location.href = '/${slug}/login'`
    );

    if (newContent !== content) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      patchCount++;
      modified = true;
    }
  }

  return patchCount;
}

function findSourceFiles(dir) {
  const results = [];
  const exts = new Set(['.js', '.jsx', '.ts', '.tsx']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
        results.push(...findSourceFiles(fullPath));
      } else if (entry.isFile() && exts.has(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

// Bug #5: Generate PM2 ecosystem config file
function writeEcosystemConfig(deployPath, pm2Name, entryPath, envVars, cwd, options = {}) {
  const appConfig = {
    name: pm2Name,
    script: options.script || entryPath,
    cwd: cwd || deployPath,
    env: envVars,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
  };
  if (options.args) appConfig.args = options.args;
  if (options.interpreter) appConfig.interpreter = options.interpreter;

  const config = { apps: [appConfig] };
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
  const frontendCandidates = ['frontend', 'client', 'web', 'app', 'dashboard'];
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
  // Next.js always needs a running server (next start), so treat as 'node'
  const isNextJs = detected.framework === 'next';
  const hasFrontend = detected.frontendDir || detected.framework;
  const hasBackend = detected.backendDir || detected.nodeEntryPoint;
  if (isNextJs) {
    // Next.js is server-rendered — needs `next start` via PM2
    detected.projectType = 'node';
    detected.nodeEntryPoint = '__nextjs__'; // sentinel: handled specially in deploy()
  } else if (hasFrontend && hasBackend) {
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
    const branch = project.git_branch || 'main';

    // Clone or pull — use VPC VCS checkout for .vpc repos, git for everything else
    if (isVpcRepo(project.git_url)) {
      // VPC VCS repo: read objects directly instead of git clone
      if (fs.existsSync(path.join(deployPath, '.vpc-deploy'))) {
        log += `> vpc-vcs pull (branch: ${branch})\n`;
        const result = pullVpcRepo(project.git_url, deployPath, branch);
        if (result.upToDate) {
          log += `Already up to date at ${result.commitHash.slice(0, 12)}\n`;
        } else {
          log += `Updated to ${result.commitHash.slice(0, 12)} (${result.fileCount} files)\n`;
        }
      } else {
        if (fs.existsSync(deployPath)) {
          fs.rmSync(deployPath, { recursive: true, force: true });
        }
        log += `> vpc-vcs checkout (branch: ${branch})\n`;
        const result = checkoutVpcRepo(project.git_url, deployPath, branch);
        log += `Checked out ${result.commitHash.slice(0, 12)} (${result.fileCount} files)\n`;
      }
    } else if (fs.existsSync(path.join(deployPath, '.git'))) {
      // Bug #1: Reset tracked files before pull to avoid "local changes would be overwritten"
      // Preserve .env and ecosystem.wh.config.js (our generated files)
      log += '> git checkout -- . && git clean -fd -e .env -e ecosystem.wh.config.js\n';
      try {
        await runCommand('git checkout -- .', deployPath);
        await runCommand('git clean -fd -e .env -e ecosystem.wh.config.js', deployPath);
      } catch (cleanErr) {
        log += `Warning: git clean failed: ${cleanErr.message}\n`;
      }

      log += `> git pull origin ${branch}\n`;
      const pullOut = await runCommand(`git pull origin ${branch}`, deployPath);
      log += pullOut + '\n';
    } else {
      if (fs.existsSync(deployPath)) {
        fs.rmSync(deployPath, { recursive: true, force: true });
      }
      log += `> git clone -b ${branch}\n`;
      const cloneOut = await runCommand(`git clone -b ${branch} "${cloneUrl}" "${deployPath}"`, HOSTING_DIR);
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
      const installOut = await runCommand(project.install_command, deployPath, { NODE_ENV: 'development' });
      log += installOut + '\n';

      // Bug #3: chmod +x node_modules/.bin after install
      chmodBinDirs(deployPath);
    }

    // Auto-patch frontend code for slug-based hosting
    // Apps in repos assume they run at "/", but VPC hosts them at "/{slug}/"
    // Patch common patterns so SPA routing and API calls work correctly
    if (detected.frontendDir || detected.framework) {
      const patchCount = patchFrontendForSlug(deployPath, project.slug, detected);
      if (patchCount > 0) {
        log += `> Auto-patched ${patchCount} frontend file(s) for /${project.slug}/ hosting\n`;
      }
    }

    // Build — remove stale Next.js lock files before building
    if (project.build_command) {
      const nextLock = path.join(deployPath, '.next', 'lock');
      const frontendDir = project.build_command.match(/^cd\s+(\S+)\s*&&/);
      if (frontendDir) {
        const fLock = path.join(deployPath, frontendDir[1], '.next', 'lock');
        if (fs.existsSync(fLock)) fs.unlinkSync(fLock);
      }
      if (fs.existsSync(nextLock)) fs.unlinkSync(nextLock);

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
      const pm2Env = { ...(project.env_vars || {}), PORT: String(port) };

      // Stop existing process
      try { await runCommand(`pm2 delete ${pm2Name}`, '/'); } catch {}

      // Detect if this is a Next.js project (sentinel from detectProjectStructure or next.config exists)
      const isNextJs = detected.framework === 'next' || project.node_entry_point === '__nextjs__';

      let ecosystemPath;
      if (isNextJs) {
        // Next.js: run `next start -p PORT` via PM2
        const nextDir = detected.frontendDir ? path.join(deployPath, detected.frontendDir) : deployPath;
        const nextBin = path.join(nextDir, 'node_modules', '.bin', 'next');
        if (!fs.existsSync(nextBin)) {
          throw new Error(`Next.js binary not found at ${nextBin}. Make sure dependencies are installed.`);
        }
        ecosystemPath = writeEcosystemConfig(deployPath, pm2Name, null, pm2Env, nextDir, {
          script: nextBin,
          args: `start -p ${port}`,
        });
        log += `> Generated PM2 ecosystem config (Next.js: next start -p ${port})\n`;
        log += `> Starting Next.js on port ${port}\n`;
      } else {
        const entryPoint = project.node_entry_point || 'index.js';
        const entryPath = path.join(deployPath, entryPoint);

        if (!fs.existsSync(entryPath)) {
          throw new Error(`Entry point "${entryPoint}" not found at ${entryPath}`);
        }

        // Bug #5: Use ecosystem config file instead of fragile shell env prefix
        const entryDir = path.dirname(entryPath);
        ecosystemPath = writeEcosystemConfig(deployPath, pm2Name, entryPath, pm2Env, entryDir);
        log += `> Generated PM2 ecosystem config\n`;
        log += `> Starting Node.js on port ${port}\n`;
      }

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
    const { rows } = await pool.query(`SELECT slug, project_type, deploy_path, output_dir, node_port, node_entry_point, status FROM web_hosting_projects WHERE status != 'stopped'`);
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
      `SELECT slug, custom_domain, project_type, deploy_path, output_dir, node_port, node_entry_point, status
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

// --- Fix with AI ---

/**
 * Parse the deploy error log to extract the error details and file path.
 */
function parseDeployError(deployLog) {
  if (!deployLog) return null;

  // Strip ANSI escape codes
  const clean = deployLog.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

  // Look for ERROR: marker but also accept logs without it (e.g. raw build output)
  const errorIdx = clean.lastIndexOf('ERROR:');

  // Use the section from ERROR: onward if found, but also keep the full log
  // Build errors (file paths, type errors) often appear BEFORE the ERROR: marker
  const errorSection = errorIdx !== -1 ? clean.slice(errorIdx) : null;

  // Search the FULL log for file path + error patterns (not just after ERROR:)
  // Pattern: ./path/to/file.tsx:line:col\nType error: ...
  // or:      path/to/file.tsx(line,col): error ...
  const fileMatch = clean.match(/\.?\/?([^\s:]+\.(tsx?|jsx?|mjs|mts)):(\d+):(\d+)\s*\n\s*(Type error|Error|SyntaxError):\s*(.+?)(?:\n\n|\n\s*\n|\n\s*(?:>|\d))/s);

  // Also try common compiler error formats: file(line,col): error TS...
  const tsMatch = !fileMatch ? clean.match(/([^\s(]+\.(tsx?|jsx?|mjs|mts))\((\d+),(\d+)\)\s*:\s*(error)\s+TS\d+:\s*(.+?)(?:\n|$)/m) : null;

  // Also try Vite/esbuild format: file:line:col: error: message
  const viteMatch = !fileMatch && !tsMatch ? clean.match(/([^\s:]+\.(tsx?|jsx?|mjs|mts|css|scss)):(\d+):(\d+):\s*(error):\s*(.+?)(?:\n|$)/m) : null;

  const match = fileMatch || tsMatch || viteMatch;

  // Build the raw error: prefer ERROR: section, fall back to last 2000 chars of log
  let rawError;
  if (errorSection) {
    rawError = errorSection.slice(0, 2000);
  } else {
    // No ERROR: marker — take the tail of the log which likely has the error
    rawError = clean.slice(-2000);
  }

  // If neither ERROR: section nor any file match found, still return with raw log tail
  if (!errorSection && !match) {
    // Accept any log that looks like it has an error
    const hasError = /error|fail|Error|FAIL/i.test(clean);
    if (!hasError) return null;
  }

  const result = {
    rawError,
    filePath: null,
    line: null,
    col: null,
    errorType: null,
    errorMessage: null,
  };

  if (match) {
    result.filePath = match[1];
    result.line = parseInt(match[3]);
    result.col = parseInt(match[4]);
    result.errorType = match[5];
    result.errorMessage = match[6].trim();
  }

  return result;
}

/**
 * Read the erroring file and surrounding context for AI analysis.
 */
function readErrorContext(deployPath, relativeFilePath, errorLine) {
  const fullPath = path.join(deployPath, relativeFilePath);
  if (!fs.existsSync(fullPath)) return null;

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  // Get a window around the error line
  const start = Math.max(0, (errorLine || 1) - 15);
  const end = Math.min(lines.length, (errorLine || lines.length) + 15);

  return {
    fullContent: content,
    fullPath,
    relativePath: relativeFilePath,
    snippet: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n'),
    totalLines: lines.length,
    errorLine,
  };
}

/**
 * Find all files with similar errors (e.g. same pattern across multiple chart components).
 */
function findSimilarErrorFiles(deployPath, errorMessage, errorFilePath) {
  if (!errorMessage) return [];

  // Extract the core pattern from the error (e.g. a type name or function pattern)
  const corePatterns = [];

  // For TypeScript formatter errors, look for the same formatter pattern
  if (errorMessage.includes('Formatter')) {
    corePatterns.push(/formatter\s*=\s*\{?\s*\(\s*value\s*:\s*number/);
  }
  // For other common patterns
  if (errorMessage.includes("is not assignable to type")) {
    const typeMatch = errorMessage.match(/type '([^']+)'/i);
    if (typeMatch) corePatterns.push(new RegExp(typeMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)));
  }

  if (corePatterns.length === 0) return [];

  const allFiles = findSourceFiles(deployPath);
  const similar = [];

  for (const filePath of allFiles) {
    if (filePath === path.join(deployPath, errorFilePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      for (const pattern of corePatterns) {
        if (pattern.test(content)) {
          const rel = path.relative(deployPath, filePath);
          similar.push({ relativePath: rel, fullPath: filePath, content });
          break;
        }
      }
    } catch {}
  }

  return similar.slice(0, 10); // Cap at 10 files
}

/**
 * Use AI to analyze deploy errors, fix the code, and redeploy.
 */
async function fixWithAI(pool, projectId) {
  const aiProvider = require('./aiProviderService');

  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');
  if (!project.last_deploy_log) throw new Error('No deploy log available. Deploy the project first.');

  const deployPath = project.deploy_path;
  if (!deployPath || !fs.existsSync(deployPath)) {
    throw new Error('Deploy path not found. Deploy the project first.');
  }

  // Parse the error from deploy log
  const parsed = parseDeployError(project.last_deploy_log);
  if (!parsed) throw new Error('Could not parse any errors from the deploy log. The log may not contain a build error.');

  let fixLog = '--- AI Fix ---\n';

  // Read the erroring file
  let errorContext = null;
  if (parsed.filePath) {
    errorContext = readErrorContext(deployPath, parsed.filePath, parsed.line);
  }

  // Find similar files that might have the same issue
  const similarFiles = parsed.filePath ? findSimilarErrorFiles(deployPath, parsed.errorMessage, parsed.filePath) : [];

  // Build AI prompt
  const systemPrompt = `You are a code fixer for web projects. You receive build errors and must return exact fixes.

RULES:
- Return ONLY a JSON array of fixes. No explanation, no markdown fences, no extra text.
- Each fix: { "file": "relative/path.tsx", "old": "exact string to find", "new": "replacement string" }
- The "old" field must be an EXACT substring of the current file content (including whitespace/indentation).
- Fix ALL files that have the same pattern, not just the one that errored.
- Keep fixes minimal — only change what's needed to resolve the error.
- For TypeScript type errors in callback props, prefer removing explicit type annotations and letting TypeScript infer types, or use permissive types.
- Never add @ts-ignore or any type suppression comments.`;

  let userPrompt = `A web project deployment failed with this build error:\n\n${parsed.rawError}\n\n`;

  if (errorContext) {
    userPrompt += `The erroring file (${errorContext.relativePath}):\n\`\`\`\n${errorContext.fullContent}\n\`\`\`\n\n`;
  }

  if (similarFiles.length > 0) {
    userPrompt += `These files have similar patterns and likely need the same fix:\n`;
    for (const sf of similarFiles) {
      userPrompt += `\n--- ${sf.relativePath} ---\n\`\`\`\n${sf.content}\n\`\`\`\n`;
    }
    userPrompt += '\n';
  }

  userPrompt += `Return a JSON array of fixes for ALL affected files. Each fix: { "file": "relative/path", "old": "exact old string", "new": "new string" }`;

  fixLog += `> Analyzing error in ${parsed.filePath || 'unknown file'}...\n`;
  if (similarFiles.length > 0) {
    fixLog += `> Found ${similarFiles.length} file(s) with similar patterns\n`;
  }

  // Call AI
  fixLog += '> Calling AI for fix suggestions...\n';
  let aiResult;
  try {
    aiResult = await aiProvider.chat(userPrompt, {
      pool,
      system: systemPrompt,
      maxTokens: 8192,
      timeout: 120000,
    });
  } catch (err) {
    throw new Error(`AI provider error: ${err.message}. Make sure an AI provider is configured in Settings > AI Providers.`);
  }

  // Parse AI response
  let fixes;
  try {
    // Extract JSON from response (handle markdown fences if AI adds them)
    let jsonStr = aiResult.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    fixes = JSON.parse(jsonStr);
    if (!Array.isArray(fixes)) throw new Error('Response is not an array');
  } catch (err) {
    throw new Error(`Failed to parse AI response: ${err.message}\nRaw response: ${aiResult.text.slice(0, 500)}`);
  }

  if (fixes.length === 0) {
    throw new Error('AI could not determine a fix for this error.');
  }

  // Apply fixes
  let appliedCount = 0;
  const failedFixes = [];

  for (const fix of fixes) {
    if (!fix.file || !fix.old || typeof fix.new !== 'string') {
      failedFixes.push({ file: fix.file || 'unknown', reason: 'Invalid fix format' });
      continue;
    }

    const fullPath = path.join(deployPath, fix.file);

    // Security: prevent path traversal
    const realDeployPath = fs.realpathSync(deployPath);
    let realFixPath;
    try {
      // For new files the path won't resolve, check parent
      realFixPath = fs.existsSync(fullPath) ? fs.realpathSync(fullPath) : fs.realpathSync(path.dirname(fullPath));
    } catch {
      failedFixes.push({ file: fix.file, reason: 'Path not found' });
      continue;
    }
    if (!realFixPath.startsWith(realDeployPath)) {
      failedFixes.push({ file: fix.file, reason: 'Path traversal blocked' });
      continue;
    }

    if (!fs.existsSync(fullPath)) {
      failedFixes.push({ file: fix.file, reason: 'File not found' });
      continue;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes(fix.old)) {
      failedFixes.push({ file: fix.file, reason: 'Old string not found in file' });
      continue;
    }

    content = content.replace(fix.old, fix.new);
    fs.writeFileSync(fullPath, content, 'utf8');
    appliedCount++;
    fixLog += `> Fixed: ${fix.file}\n`;
  }

  if (failedFixes.length > 0) {
    for (const f of failedFixes) {
      fixLog += `> Warning: Could not fix ${f.file} — ${f.reason}\n`;
    }
  }

  if (appliedCount === 0) {
    throw new Error(`AI suggested ${fixes.length} fix(es) but none could be applied:\n${failedFixes.map(f => `  ${f.file}: ${f.reason}`).join('\n')}`);
  }

  fixLog += `> Applied ${appliedCount} fix(es). Redeploying...\n`;

  // Update log so user can see progress
  await pool.query(
    `UPDATE web_hosting_projects SET last_deploy_log = $1, updated_at = NOW() WHERE id = $2`,
    [project.last_deploy_log + '\n' + fixLog, project.id]
  );

  // Redeploy — skip git pull since we just patched the local files
  // Run install + build + start (same steps as deploy minus git clone/pull)
  let buildLog = '';
  try {
    // Write .env file so build can access env vars
    const envVars = project.env_vars || {};
    writeEnvFile(deployPath, envVars);

    // Re-run install command (dependencies may need refresh after patching)
    if (project.install_command) {
      buildLog += `> ${project.install_command}\n`;
      const installOut = await runCommand(project.install_command, deployPath, { NODE_ENV: 'development' });
      buildLog += installOut + '\n';
      chmodBinDirs(deployPath);
    }

    // Remove stale Next.js lock files before building
    if (project.build_command) {
      const nextLock = path.join(deployPath, '.next', 'lock');
      const frontendDir = project.build_command.match(/^cd\s+(\S+)\s*&&/);
      if (frontendDir) {
        const fLock = path.join(deployPath, frontendDir[1], '.next', 'lock');
        if (fs.existsSync(fLock)) fs.unlinkSync(fLock);
      }
      if (fs.existsSync(nextLock)) fs.unlinkSync(nextLock);

      buildLog += `> ${project.build_command}\n`;
      const buildOut = await runCommand(project.build_command, deployPath);
      buildLog += buildOut + '\n';
    }

    // Start Node backend if needed
    if (project.project_type === 'node' || project.project_type === 'fullstack') {
      let port = project.node_port;
      if (!port) {
        port = await getNextPort(pool);
      }
      const pm2Name = project.pm2_name || `wh-${project.slug}`;

      // Stop existing process
      try { await runCommand(`pm2 delete ${pm2Name}`, '/'); } catch {}

      const detected = detectProjectStructure(deployPath, project.slug);
      const isNextJs = detected.framework === 'next' || project.node_entry_point === '__nextjs__';
      const pm2Env = { ...(project.env_vars || {}), PORT: String(port) };

      let ecosystemPath;
      if (isNextJs) {
        const nextDir = detected.frontendDir ? path.join(deployPath, detected.frontendDir) : deployPath;
        const nextBin = path.join(nextDir, 'node_modules', '.bin', 'next');
        if (!fs.existsSync(nextBin)) {
          throw new Error(`Next.js binary not found at ${nextBin}`);
        }
        ecosystemPath = writeEcosystemConfig(deployPath, pm2Name, null, pm2Env, nextDir, {
          script: nextBin,
          args: `start -p ${port}`,
        });
        buildLog += `> Starting Next.js on port ${port}\n`;
      } else {
        const entryPoint = project.node_entry_point || 'index.js';
        const entryPath = path.join(deployPath, entryPoint);
        if (!fs.existsSync(entryPath)) {
          throw new Error(`Entry point "${entryPoint}" not found`);
        }
        const entryDir = path.dirname(entryPath);
        ecosystemPath = writeEcosystemConfig(deployPath, pm2Name, entryPath, pm2Env, entryDir);
        buildLog += `> Starting Node.js on port ${port}\n`;
      }

      const startOut = await runCommand(`pm2 start "${ecosystemPath}"`, deployPath);
      buildLog += startOut + '\n';
      await runCommand('pm2 save', '/');

      await pool.query(
        `UPDATE web_hosting_projects SET node_port = $1, pm2_name = $2, status = 'running', last_deploy_at = NOW(), last_deploy_log = $3, updated_at = NOW() WHERE id = $4`,
        [port, pm2Name, project.last_deploy_log + '\n' + fixLog + buildLog, project.id]
      );
    } else {
      await pool.query(
        `UPDATE web_hosting_projects SET status = 'running', last_deploy_at = NOW(), last_deploy_log = $1, updated_at = NOW() WHERE id = $2`,
        [project.last_deploy_log + '\n' + fixLog + buildLog, project.id]
      );
    }

    await refreshSlugCache(pool);
    await refreshDomainCache(pool);

    return { success: true, fixesApplied: appliedCount, log: fixLog + buildLog };
  } catch (err) {
    buildLog += `\nERROR: ${err.message}\n`;
    await pool.query(
      `UPDATE web_hosting_projects SET status = 'error', last_deploy_log = $1, updated_at = NOW() WHERE id = $2`,
      [project.last_deploy_log + '\n' + fixLog + buildLog, project.id]
    );
    throw new Error(fixLog + buildLog);
  }
}

module.exports = {
  createProject, getProject, getProjectBySlug, listProjects, updateProject, deleteProject,
  deploy, redeploy, fixWithAI, startBackend, stopBackend, restartBackend, getLogs, getStatus, getNextPort,
  refreshSlugCache, getSlugCache, refreshDomainCache, getDomainCache, getProjectByDomain,
  generateDomainVerifyToken, verifyDomain, removeDomain,
  detectProjectStructure, buildCloneUrl,
  RESERVED_SLUGS, HOSTING_DIR, ensureHostingDir
};
