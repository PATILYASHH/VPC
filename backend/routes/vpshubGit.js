const express = require('express');
const { spawn } = require('child_process');
const router = express.Router();
const { getRepoPath } = require('../services/vpshubGitService');
const { authenticateGitRequest, checkRepoAccess } = require('../services/vpshubAuthService');

// Git Smart HTTP Protocol
// Ref: https://git-scm.com/docs/http-protocol

// Middleware: resolve repo and authenticate
async function resolveRepo(req, res, next) {
  const { owner, repo } = req.params;
  const repoSlug = repo.replace(/\.git$/, '');
  const pool = req.app.locals.pool;

  // Look up repo in DB
  const { rows } = await pool.query(
    `SELECT r.*, a.username as owner_username
     FROM vpshub_repositories r
     JOIN vpc_admins a ON a.id = r.owner_id
     WHERE a.username = $1 AND r.slug = $2`,
    [owner, repoSlug]
  );

  if (rows.length === 0) {
    return res.status(404).send('Repository not found');
  }

  req.repoInfo = rows[0];
  req.repoPath = getRepoPath(owner, repoSlug);
  next();
}

// Middleware: authenticate for git operations
async function authenticateGit(req, res, next) {
  const pool = req.app.locals.pool;
  const authHeader = req.headers.authorization;

  // Public repos allow read without auth
  const isRead = req.query.service === 'git-upload-pack' || req.url.includes('git-upload-pack');

  if (req.repoInfo.visibility === 'public' && isRead) {
    req.gitUser = null;
    return next();
  }

  // All write operations and private repo reads require auth
  const user = await authenticateGitRequest(pool, authHeader);
  if (!user) {
    res.setHeader('WWW-Authenticate', 'Basic realm="VPSHub"');
    return res.status(401).send('Authentication required');
  }

  // Check access
  const requiredPerm = isRead ? 'read' : 'write';
  const hasAccess = await checkRepoAccess(pool, user.userId, req.repoInfo.id, requiredPerm);

  // Owner always has access
  if (!hasAccess && req.repoInfo.owner_id !== user.userId) {
    return res.status(403).send('Access denied');
  }

  req.gitUser = user;
  next();
}

// GET /:owner/:repo.git/info/refs?service=git-upload-pack|git-receive-pack
router.get('/:owner/:repo/info/refs', resolveRepo, authenticateGit, (req, res) => {
  const service = req.query.service;
  if (!service || !['git-upload-pack', 'git-receive-pack'].includes(service)) {
    return res.status(400).send('Invalid service');
  }

  res.setHeader('Content-Type', `application/x-${service}-advertisement`);
  res.setHeader('Cache-Control', 'no-cache');

  // Send the pkt-line header
  const header = `# service=${service}\n`;
  const pktHeader = pktLine(header) + '0000';
  res.write(pktHeader);

  // Spawn git service with --advertise-refs
  const args = [service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', req.repoPath];
  const proc = spawn('git', args);

  proc.stdout.pipe(res);
  proc.stderr.on('data', (data) => {
    console.error(`[VPSHub Git] ${service} stderr:`, data.toString());
  });
  proc.on('error', (err) => {
    console.error(`[VPSHub Git] spawn error:`, err.message);
    if (!res.headersSent) res.status(500).send('Git service error');
  });
  proc.on('close', () => {
    res.end();
  });
});

// POST /:owner/:repo.git/git-upload-pack (clone/fetch)
router.post('/:owner/:repo/git-upload-pack', resolveRepo, authenticateGit, (req, res) => {
  res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
  res.setHeader('Cache-Control', 'no-cache');

  const proc = spawn('git', ['upload-pack', '--stateless-rpc', req.repoPath]);

  req.pipe(proc.stdin);
  proc.stdout.pipe(res);
  proc.stderr.on('data', (data) => {
    console.error('[VPSHub Git] upload-pack stderr:', data.toString());
  });
  proc.on('error', (err) => {
    console.error('[VPSHub Git] upload-pack error:', err.message);
    if (!res.headersSent) res.status(500).send('Git service error');
  });
  proc.on('close', () => {
    res.end();
  });
});

// POST /:owner/:repo.git/git-receive-pack (push)
router.post('/:owner/:repo/git-receive-pack', resolveRepo, authenticateGit, async (req, res) => {
  res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
  res.setHeader('Cache-Control', 'no-cache');

  const proc = spawn('git', ['receive-pack', '--stateless-rpc', req.repoPath]);

  req.pipe(proc.stdin);
  proc.stdout.pipe(res);
  proc.stderr.on('data', (data) => {
    console.error('[VPSHub Git] receive-pack stderr:', data.toString());
  });
  proc.on('error', (err) => {
    console.error('[VPSHub Git] receive-pack error:', err.message);
    if (!res.headersSent) res.status(500).send('Git service error');
  });
  proc.on('close', async () => {
    // Update repo size after push
    try {
      const pool = req.app.locals.pool;
      const { updateRepoSize } = require('../services/vpshubGitService');
      await updateRepoSize(pool, req.repoInfo.id, req.repoInfo.owner_username, req.repoInfo.slug);
      // Update timestamp
      await pool.query('UPDATE vpshub_repositories SET updated_at = NOW() WHERE id = $1', [req.repoInfo.id]);

      // Auto-deploy: run migrations + redeploy hosting if linked
      const deployService = require('../services/vpshubDeployService');
      const results = await deployService.onPush(pool, req.repoInfo.owner_username, req.repoInfo.slug);
      if (results) {
        if (results.migrations && results.migrations.length > 0) {
          const applied = results.migrations.filter(r => r.status === 'applied').length;
          const failed = results.migrations.filter(r => r.status === 'failed').length;
          if (applied > 0) console.log(`[VPSHub] Auto-deployed ${applied} migration(s) for ${req.repoInfo.slug}`);
          if (failed > 0) console.error(`[VPSHub] ${failed} migration(s) failed for ${req.repoInfo.slug}`);
        }
        if (results.hosting) {
          if (results.hosting.success) console.log(`[VPSHub] Auto-redeployed hosting for ${req.repoInfo.slug}`);
          else if (results.hosting.error) console.error(`[VPSHub] Hosting redeploy failed: ${results.hosting.error}`);
        }
      }
    } catch (err) {
      console.error('[VPSHub Git] post-push update error:', err.message);
    }
    res.end();
  });
});

// Helper: create a pkt-line
function pktLine(data) {
  const len = (data.length + 4).toString(16).padStart(4, '0');
  return `${len}${data}`;
}

module.exports = router;
