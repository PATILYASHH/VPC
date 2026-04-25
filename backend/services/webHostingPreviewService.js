// PR preview deployments — Netlify/Vercel-style.
//
// When a GitHub PR is opened against a project's deploy branch, we build the
// PR's HEAD commit into its own directory (`~/web-hosting/<slug>-pr-<n>`) on a
// fresh port and PM2 process, served at `/<slug>-pr-<n>/`. We post a sticky
// comment on the PR with the preview URL and rebuild on every push. When the
// PR closes (merged or not), the preview is torn down.
//
// Wiring:
//   1. User toggles "PR Previews" on, gets a webhook URL + secret.
//   2. They paste those into GitHub repo Settings → Webhooks.
//   3. GitHub POSTs pull_request events to /api/webhooks/github/wh/:projectId.
//   4. We HMAC-verify, dispatch to handleEvent, build/destroy as appropriate.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const webHostingService = require('./webHostingService');

const PREVIEW_PM2_PREFIX = 'wh-prev-';
const COMMENT_MARKER = '<!-- vpc-preview -->';

// ── Self-healing schema ─────────────────────────────────────────
let _schemaDone = false;
async function ensureSchema(pool) {
  if (_schemaDone) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_hosting_previews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT,
      pr_url TEXT,
      pr_user VARCHAR(150),
      head_ref VARCHAR(255),
      head_sha VARCHAR(64),
      head_repo_url TEXT,
      preview_slug VARCHAR(150) NOT NULL,
      deploy_path TEXT,
      node_port INTEGER,
      pm2_name VARCHAR(150),
      status VARCHAR(32) DEFAULT 'building',
      last_build_log TEXT,
      last_built_at TIMESTAMPTZ,
      last_comment_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (project_id, pr_number)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_wh_previews_slug ON web_hosting_previews(preview_slug)`);
  await pool.query(`ALTER TABLE web_hosting_projects ADD COLUMN IF NOT EXISTS previews_enabled BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE web_hosting_projects ADD COLUMN IF NOT EXISTS previews_webhook_secret VARCHAR(64)`);
  _schemaDone = true;
}

// ── Settings / webhook secret ───────────────────────────────────
async function getSettings(pool, projectId) {
  await ensureSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, slug, previews_enabled, previews_webhook_secret FROM web_hosting_projects WHERE id = $1`,
    [projectId]
  );
  if (!rows[0]) throw new Error('Project not found');
  return {
    enabled: !!rows[0].previews_enabled,
    secret: rows[0].previews_webhook_secret || null,
    slug: rows[0].slug,
  };
}

async function setEnabled(pool, projectId, enabled, regenerateSecret = false) {
  await ensureSchema(pool);
  const { rows: existing } = await pool.query(
    `SELECT previews_webhook_secret FROM web_hosting_projects WHERE id = $1`,
    [projectId]
  );
  let secret = existing[0]?.previews_webhook_secret || null;
  if (enabled && (!secret || regenerateSecret)) {
    secret = crypto.randomBytes(24).toString('hex');
  }
  await pool.query(
    `UPDATE web_hosting_projects SET previews_enabled = $1, previews_webhook_secret = $2, updated_at = NOW() WHERE id = $3`,
    [!!enabled, secret, projectId]
  );
  return { enabled: !!enabled, secret };
}

// ── HMAC verification ───────────────────────────────────────────
function verifySignature(secret, signatureHeader, rawBody) {
  if (!secret || !signatureHeader || !rawBody) return false;
  const sig = String(signatureHeader);
  if (!sig.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Preview list / lookup ───────────────────────────────────────
async function listPreviews(pool, projectId) {
  await ensureSchema(pool);
  const { rows } = await pool.query(
    `SELECT * FROM web_hosting_previews
     WHERE project_id = $1 AND status != 'closed'
     ORDER BY pr_number DESC`,
    [projectId]
  );
  return rows;
}

async function getPreview(pool, previewId) {
  await ensureSchema(pool);
  const { rows } = await pool.query(`SELECT * FROM web_hosting_previews WHERE id = $1`, [previewId]);
  return rows[0] || null;
}

async function getPreviewByPR(pool, projectId, prNumber) {
  await ensureSchema(pool);
  const { rows } = await pool.query(
    `SELECT * FROM web_hosting_previews WHERE project_id = $1 AND pr_number = $2`,
    [projectId, prNumber]
  );
  return rows[0] || null;
}

// All active preview slugs (for slug cache)
async function listActiveForCache(pool) {
  await ensureSchema(pool);
  const { rows } = await pool.query(
    `SELECT p.preview_slug AS slug, wh.project_type, p.deploy_path, wh.output_dir,
            p.node_port, wh.node_entry_point, p.status
     FROM web_hosting_previews p
     JOIN web_hosting_projects wh ON wh.id = p.project_id
     WHERE p.status IN ('ready', 'building')`
  );
  return rows;
}

// ── Build / rebuild ─────────────────────────────────────────────
function previewSlug(baseSlug, prNumber) {
  return `${baseSlug}-pr-${prNumber}`;
}

async function getNextPreviewPort(pool) {
  // Pick a port higher than anything used by either projects or previews
  const [{ rows: a }, { rows: b }] = await Promise.all([
    pool.query(`SELECT COALESCE(MAX(node_port), 0) AS m FROM web_hosting_projects`),
    pool.query(`SELECT COALESCE(MAX(node_port), 0) AS m FROM web_hosting_previews`),
  ]);
  return Math.max(parseInt(a[0].m) || 0, parseInt(b[0].m) || 0, 4000) + 1;
}

async function upsertPreviewRow(pool, project, prMeta) {
  await ensureSchema(pool);
  const slug = previewSlug(project.slug, prMeta.prNumber);
  const HOSTING_DIR = webHostingService.HOSTING_DIR;
  const deployPath = path.join(HOSTING_DIR, slug);

  const { rows } = await pool.query(
    `INSERT INTO web_hosting_previews
       (project_id, pr_number, pr_title, pr_url, pr_user, head_ref, head_sha, head_repo_url,
        preview_slug, deploy_path, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'building', NOW())
     ON CONFLICT (project_id, pr_number) DO UPDATE SET
       pr_title = EXCLUDED.pr_title,
       pr_url = EXCLUDED.pr_url,
       head_ref = EXCLUDED.head_ref,
       head_sha = EXCLUDED.head_sha,
       head_repo_url = EXCLUDED.head_repo_url,
       status = 'building',
       updated_at = NOW()
     RETURNING *`,
    [project.id, prMeta.prNumber, prMeta.title || null, prMeta.url || null, prMeta.user || null,
     prMeta.headRef, prMeta.headSha, prMeta.headRepoUrl, slug, deployPath]
  );
  return rows[0];
}

async function buildPreview(pool, project, preview) {
  webHostingService.ensureHostingDir();
  const HOSTING_DIR = webHostingService.HOSTING_DIR;
  const deployPath = preview.deploy_path;
  const slug = preview.preview_slug;
  let log = `> Building preview for PR #${preview.pr_number} (${preview.head_ref} @ ${(preview.head_sha || '').slice(0, 8)})\n`;

  // Resolve a GitHub token so we can clone private/forked repos that need auth
  let token = null;
  try {
    const credResolver = require('./credentialResolver');
    const resolved = await credResolver.resolve(pool, 'github', { app: 'web-hosting-preview', resource: project.id });
    if (resolved?.credentials?.token) token = resolved.credentials.token;
  } catch {}

  const cloneUrl = webHostingService.buildCloneUrl(preview.head_repo_url, token);
  const pm2Name = `${PREVIEW_PM2_PREFIX}${slug}`;

  // Tear down any prior build (PM2 + dir)
  try { await runCmd(`pm2 delete ${pm2Name}`, '/'); } catch {}
  if (fs.existsSync(deployPath)) {
    try { fs.rmSync(deployPath, { recursive: true, force: true }); } catch {}
  }

  try {
    log += `> git clone -b ${preview.head_ref}\n`;
    log += await runCmd(`git clone -b ${preview.head_ref} "${cloneUrl}" "${deployPath}"`, HOSTING_DIR) + '\n';

    // Pin to the exact commit the PR webhook fired for (avoid race if more pushes land mid-build)
    if (preview.head_sha) {
      try {
        await runCmd(`git checkout ${preview.head_sha}`, deployPath);
        log += `> Pinned to ${preview.head_sha.slice(0, 12)}\n`;
      } catch (e) {
        log += `> Warning: could not pin to ${preview.head_sha.slice(0, 12)}: ${e.message}\n`;
      }
    }

    const detected = webHostingService.detectProjectStructure(deployPath, slug);
    log += `> Detected: framework=${detected.framework || 'none'}, type=${detected.projectType}\n`;

    // Reuse the parent project's commands when not auto-detected
    const installCommand = detected.installCommand || project.install_command;
    let buildCommand = detected.buildCommand || project.build_command;
    // Rewrite the slug-base in build command (e.g. vite --base=/<slug>/)
    if (buildCommand && project.slug) {
      buildCommand = buildCommand.split(`/${project.slug}/`).join(`/${slug}/`);
    }
    const outputDir = detected.outputDir || project.output_dir;
    const projectType = detected.projectType || project.project_type || 'static';
    const nodeEntry = detected.nodeEntryPoint || project.node_entry_point || 'index.js';
    const isNextJs = detected.framework === 'next' || nodeEntry === '__nextjs__';

    // .env from parent (previews use the same env as production by default)
    const envVars = project.env_vars || {};
    if (Object.keys(envVars).length > 0) {
      const lines = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      fs.writeFileSync(path.join(deployPath, '.env'), lines);
      const subDirs = ['backend', 'server', 'api', 'frontend', 'client', 'web', 'app', 'dashboard'];
      for (const dir of subDirs) {
        const subDir = path.join(deployPath, dir);
        if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
          fs.writeFileSync(path.join(subDir, '.env'), lines);
        }
      }
    }

    if (installCommand) {
      log += `> ${installCommand}\n`;
      log += await runCmd(installCommand, deployPath, { NODE_ENV: 'development' }) + '\n';
    }

    // Apply slug-base patches so the preview can serve under /<slug>-pr-<n>/
    if (detected.frontendDir || detected.framework) {
      try {
        const synthetic = { slug, ...project };
        // The patcher looks at `slug` only; works for previews
        const patchCount = patchForPreviewSlug(deployPath, slug, detected);
        if (patchCount > 0) log += `> Patched ${patchCount} file(s) for /${slug}/ path\n`;
      } catch (e) {
        log += `> Patch warning: ${e.message}\n`;
      }
    }

    if (buildCommand) {
      log += `> ${buildCommand}\n`;
      log += await runCmd(buildCommand, deployPath) + '\n';
    }

    // Healthcheck — start PM2 if node, otherwise verify HTML output
    let port = null;
    if (projectType === 'node' || projectType === 'fullstack') {
      port = await getNextPreviewPort(pool);
      const pm2Env = { ...envVars, PORT: String(port) };

      let ecosystemPath;
      if (isNextJs) {
        const nextDir = detected.frontendDir ? path.join(deployPath, detected.frontendDir) : deployPath;
        const nextBin = path.join(nextDir, 'node_modules', '.bin', 'next');
        if (!fs.existsSync(nextBin)) throw new Error(`Next.js binary not found at ${nextBin}`);
        ecosystemPath = writeEcosystem(deployPath, pm2Name, null, pm2Env, nextDir, {
          script: nextBin, args: `start -p ${port}`,
        });
      } else {
        const entryPath = path.join(deployPath, nodeEntry);
        if (!fs.existsSync(entryPath)) throw new Error(`Entry point "${nodeEntry}" not found`);
        ecosystemPath = writeEcosystem(deployPath, pm2Name, entryPath, pm2Env, path.dirname(entryPath));
      }
      log += `> pm2 start (port ${port})\n`;
      log += await runCmd(`pm2 start "${ecosystemPath}"`, deployPath) + '\n';

      const ok = await probeHttp('127.0.0.1', port, 12000);
      if (!ok) {
        try { await runCmd(`pm2 delete ${pm2Name}`, '/'); } catch {}
        throw new Error(`Preview server on port ${port} did not respond`);
      }
      log += `> Healthcheck OK\n`;
      try { await runCmd('pm2 save', '/'); } catch {}
    } else {
      const checkBase = outputDir ? path.join(deployPath, outputDir) : deployPath;
      if (!fs.existsSync(checkBase)) throw new Error(`Output dir not found (${outputDir || '.'})`);
      const indexPath = path.join(checkBase, 'index.html');
      if (!fs.existsSync(indexPath)) {
        const hasHtml = fs.readdirSync(checkBase).some((f) => f.endsWith('.html'));
        if (!hasHtml) throw new Error('No HTML output produced');
      }
    }

    await pool.query(
      `UPDATE web_hosting_previews SET status = 'ready', node_port = $1, pm2_name = $2,
        last_build_log = $3, last_built_at = NOW(), updated_at = NOW() WHERE id = $4`,
      [port, port ? pm2Name : null, log, preview.id]
    );

    return { status: 'ready', log };
  } catch (err) {
    log += `\nERROR: ${err.message}\n`;
    await pool.query(
      `UPDATE web_hosting_previews SET status = 'error', last_build_log = $1, last_built_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [log, preview.id]
    );
    return { status: 'error', log, error: err.message };
  }
}

// Local copies of patcher / runner / ecosystem to avoid importing private bits
function patchForPreviewSlug(deployPath, slug, detected) {
  // Reuse the existing patch logic by temporarily monkey-calling the public service
  // (patchFrontendForSlug is private — we re-implement the minimum: BrowserRouter basename + axios baseURL).
  let patchCount = 0;
  const srcDir = detected.frontendDir
    ? path.join(deployPath, detected.frontendDir, 'src')
    : path.join(deployPath, 'src');
  if (!fs.existsSync(srcDir)) return 0;

  const exts = new Set(['.js', '.jsx', '.ts', '.tsx']);
  function walk(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) results = results.concat(walk(p));
      else if (entry.isFile() && exts.has(path.extname(entry.name))) results.push(p);
    }
    return results;
  }

  for (const file of walk(srcDir)) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    let next = content;
    next = next.replace(/(<BrowserRouter)(?!\s+basename)([\s>])/g, `$1 basename="/${slug}"$2`);
    next = next.replace(/baseURL:\s*['"]\/api['"]/g, `baseURL: '/${slug}/api'`);
    next = next.replace(/axios\.defaults\.baseURL\s*=\s*['"]\/api['"]/g, `axios.defaults.baseURL = '/${slug}/api'`);
    if (next !== content) {
      fs.writeFileSync(file, next, 'utf8');
      patchCount++;
    }
  }
  return patchCount;
}

function writeEcosystem(deployPath, pm2Name, entryPath, envVars, cwd, options = {}) {
  const appConfig = {
    name: pm2Name,
    script: options.script || entryPath,
    cwd: cwd || deployPath,
    env: envVars,
    autorestart: true,
    max_restarts: 5,
    restart_delay: 1000,
  };
  if (options.args) appConfig.args = options.args;
  const config = { apps: [appConfig] };
  const filePath = path.join(deployPath, 'ecosystem.preview.config.js');
  fs.writeFileSync(filePath, `module.exports = ${JSON.stringify(config, null, 2)};\n`);
  return filePath;
}

function runCmd(cmd, cwd, env = {}) {
  const { exec } = require('child_process');
  return new Promise((resolve, reject) => {
    const extraPaths = [];
    if (cwd) {
      let dir = cwd;
      for (let i = 0; i < 5; i++) {
        const binDir = path.join(dir, 'node_modules', '.bin');
        if (fs.existsSync(binDir)) extraPaths.push(binDir);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    const PATH = (extraPaths.length ? extraPaths.join(':') + ':' : '') + (process.env.PATH || '');
    const mergedEnv = { ...process.env, ...env, PATH };
    exec(cmd, { cwd, timeout: 300000, maxBuffer: 10 * 1024 * 1024, env: mergedEnv }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stdout || ''}${stderr || ''}`));
      else resolve((stdout || '') + (stderr || ''));
    });
  });
}

function probeHttp(host, port, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tryOnce = () => {
      const req = http.request({ host, port, path: '/', method: 'GET', timeout: 2500 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tryOnce, 700);
      });
      req.on('error', () => Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tryOnce, 700));
      req.on('timeout', () => { req.destroy(); Date.now() - start > timeoutMs ? resolve(false) : setTimeout(tryOnce, 700); });
      req.end();
    };
    setTimeout(tryOnce, 1500);
  });
}

// ── Tear down ──────────────────────────────────────────────────
async function closePreview(pool, previewId) {
  const preview = await getPreview(pool, previewId);
  if (!preview) return { closed: true };
  if (preview.pm2_name) {
    try { await runCmd(`pm2 delete ${preview.pm2_name}`, '/'); } catch {}
  }
  if (preview.deploy_path && fs.existsSync(preview.deploy_path)) {
    try { fs.rmSync(preview.deploy_path, { recursive: true, force: true }); } catch {}
  }
  await pool.query(
    `UPDATE web_hosting_previews SET status = 'closed', updated_at = NOW() WHERE id = $1`,
    [previewId]
  );
  return { closed: true };
}

// ── PR sticky comment ──────────────────────────────────────────
async function commentOnPR(pool, project, preview, body) {
  // Find a usable GitHub token
  let token = null;
  try {
    const credResolver = require('./credentialResolver');
    const resolved = await credResolver.resolve(pool, 'github', { app: 'web-hosting-preview', resource: project.id });
    if (resolved?.credentials?.token) token = resolved.credentials.token;
  } catch {}
  if (!token) return; // Nothing we can do without a token

  // Parse owner/repo from the project's git URL
  const match = (project.git_url || '').match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?/i);
  if (!match) return;
  const owner = match[1];
  const repo = match[2];

  const ghHeaders = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VPC-Preview-Bot',
  };

  const wrappedBody = `${COMMENT_MARKER}\n${body}`;

  // If we have a saved comment id, update it directly
  if (preview.last_comment_id) {
    const r = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${preview.last_comment_id}`,
      { method: 'PATCH', headers: ghHeaders, body: JSON.stringify({ body: wrappedBody }) }
    );
    if (r.ok) return;
    // Fall through and post a new comment if the old one was deleted
  }

  // Otherwise look for an existing sticky comment by marker
  try {
    const list = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${preview.pr_number}/comments?per_page=100`,
      { headers: ghHeaders }
    );
    if (list.ok) {
      const comments = await list.json();
      const sticky = comments.find((c) => typeof c.body === 'string' && c.body.includes(COMMENT_MARKER));
      if (sticky) {
        const upd = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues/comments/${sticky.id}`,
          { method: 'PATCH', headers: ghHeaders, body: JSON.stringify({ body: wrappedBody }) }
        );
        if (upd.ok) {
          await pool.query(
            `UPDATE web_hosting_previews SET last_comment_id = $1 WHERE id = $2`,
            [sticky.id, preview.id]
          );
          return;
        }
      }
    }
  } catch {}

  // Create a new comment
  const create = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${preview.pr_number}/comments`,
    { method: 'POST', headers: ghHeaders, body: JSON.stringify({ body: wrappedBody }) }
  );
  if (create.ok) {
    const c = await create.json();
    await pool.query(
      `UPDATE web_hosting_previews SET last_comment_id = $1 WHERE id = $2`,
      [c.id, preview.id]
    );
  }
}

function buildCommentBody({ status, slug, host, log, headSha, error }) {
  const previewUrl = `${host.replace(/\/$/, '')}/${slug}/`;
  const head = headSha ? headSha.slice(0, 12) : '';
  if (status === 'ready') {
    return [
      '**🚀 Preview deployment ready**',
      '',
      `📦 Build: \`${head}\``,
      `🔗 Preview: ${previewUrl}`,
      '',
      '<sub>Updates automatically on every push. Closes when this PR is merged or closed.</sub>',
    ].join('\n');
  }
  if (status === 'error') {
    const tail = (log || '').slice(-1500);
    return [
      '**❌ Preview deployment failed**',
      '',
      `📦 Build: \`${head}\``,
      '',
      '<details><summary>Build log (tail)</summary>',
      '',
      '```',
      tail || error || 'no log',
      '```',
      '</details>',
    ].join('\n');
  }
  return [
    '**⏳ Preview deployment building…**',
    '',
    `📦 Build: \`${head}\``,
  ].join('\n');
}

// ── Webhook event handler ──────────────────────────────────────
async function handleEvent(pool, project, event, payload, host) {
  if (event !== 'pull_request') return { ignored: true, reason: `event=${event}` };
  const action = payload.action;
  const pr = payload.pull_request;
  if (!pr) return { ignored: true, reason: 'no pull_request' };

  // Only build PRs that target the project's deploy branch
  const targetBranch = project.git_branch || 'main';
  if (pr.base?.ref && pr.base.ref !== targetBranch) {
    return { ignored: true, reason: `base=${pr.base.ref} != ${targetBranch}` };
  }

  const prMeta = {
    prNumber: pr.number,
    title: pr.title,
    url: pr.html_url,
    user: pr.user?.login,
    headRef: pr.head?.ref,
    headSha: pr.head?.sha,
    headRepoUrl: pr.head?.repo?.clone_url,
  };

  if (['opened', 'reopened', 'synchronize', 'edited'].includes(action)) {
    if (!prMeta.headRef || !prMeta.headRepoUrl) {
      return { ignored: true, reason: 'PR head missing' };
    }
    const preview = await upsertPreviewRow(pool, project, prMeta);
    // Post "building" comment immediately
    await commentOnPR(pool, project, preview, buildCommentBody({
      status: 'building', slug: preview.preview_slug, host, headSha: prMeta.headSha,
    })).catch(() => {});
    // Build asynchronously
    buildAndComment(pool, project, preview, host).catch((err) =>
      console.error('[preview] build failed:', err.message)
    );
    return { handled: 'build', previewId: preview.id };
  }

  if (action === 'closed') {
    const preview = await getPreviewByPR(pool, project.id, pr.number);
    if (preview) {
      await closePreview(pool, preview.id);
      // Post final comment
      await commentOnPR(pool, project, preview,
        '**🧹 Preview deployment removed** — PR is closed.'
      ).catch(() => {});
      // Refresh slug cache after teardown
      try { await webHostingService.refreshSlugCache(pool); } catch {}
    }
    return { handled: 'close', previewId: preview?.id };
  }

  return { ignored: true, reason: `action=${action}` };
}

async function buildAndComment(pool, project, preview, host) {
  const result = await buildPreview(pool, project, preview);
  // Re-read so we have the latest port/pm2_name for the comment
  const fresh = await getPreview(pool, preview.id);
  await commentOnPR(pool, project, fresh, buildCommentBody({
    status: result.status,
    slug: fresh.preview_slug,
    host,
    log: result.log,
    headSha: fresh.head_sha,
    error: result.error,
  })).catch(() => {});
  // Refresh slug cache so the preview becomes routable
  try { await webHostingService.refreshSlugCache(pool); } catch {}
  return result;
}

// Manual rebuild from the dashboard
async function rebuildPreview(pool, project, previewId, host) {
  const preview = await getPreview(pool, previewId);
  if (!preview) throw new Error('Preview not found');
  await pool.query(
    `UPDATE web_hosting_previews SET status = 'building', updated_at = NOW() WHERE id = $1`,
    [previewId]
  );
  return buildAndComment(pool, project, preview, host);
}

module.exports = {
  ensureSchema,
  getSettings,
  setEnabled,
  verifySignature,
  listPreviews,
  getPreview,
  getPreviewByPR,
  listActiveForCache,
  handleEvent,
  buildPreview,
  rebuildPreview,
  closePreview,
  commentOnPR,
  buildCommentBody,
};
