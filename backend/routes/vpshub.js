const express = require('express');
const router = express.Router();
const gitService = require('../services/vpshubGitService');
const authService = require('../services/vpshubAuthService');

// ─── Repo slug validation ────────────────────────────────────

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── Repository CRUD ─────────────────────────────────────────

// List all repos (for current user, or all if admin)
router.get('/repos', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repos = await gitService.getAllRepositories(pool);
    res.json({ repos });
  } catch (err) {
    console.error('[VPSHub] List repos error:', err.message);
    res.status(500).json({ error: 'Failed to list repositories' });
  }
});

// Create repository
router.post('/repos', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, description, visibility, initReadme } = req.body;

    if (!name || name.length < 1 || name.length > 100) {
      return res.status(400).json({ error: 'Repository name must be 1-100 characters' });
    }

    const slug = slugify(name);
    if (!slug) {
      return res.status(400).json({ error: 'Invalid repository name' });
    }

    // Check if slug already exists for this user
    const existing = await gitService.getRepositoryBySlug(pool, req.admin.username, slug);
    if (existing) {
      return res.status(409).json({ error: 'Repository with this name already exists' });
    }

    const repo = await gitService.createRepository(pool, {
      ownerId: req.admin.id,
      ownerUsername: req.admin.username,
      name,
      slug,
      description,
      visibility,
      initReadme: initReadme !== false,
    });

    res.status(201).json({ repo: { ...repo, owner_username: req.admin.username } });
  } catch (err) {
    console.error('[VPSHub] Create repo error:', err.message);
    res.status(500).json({ error: 'Failed to create repository' });
  }
});

// Get repository details
router.get('/repos/:owner/:repo', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const hasCommits = await gitService.repoHasCommits(repo.owner_username, repo.slug);
    const branches = await gitService.getBranches(repo.owner_username, repo.slug);
    const defaultBranch = await gitService.getDefaultBranch(repo.owner_username, repo.slug);

    res.json({ repo: { ...repo, has_commits: hasCommits, branches, default_branch: defaultBranch } });
  } catch (err) {
    console.error('[VPSHub] Get repo error:', err.message);
    res.status(500).json({ error: 'Failed to get repository' });
  }
});

// Update repository
router.put('/repos/:owner/:repo', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    if (repo.owner_id !== req.admin.id) {
      return res.status(403).json({ error: 'Not the repository owner' });
    }

    const updated = await gitService.updateRepository(pool, repo.id, req.body);
    res.json({ repo: updated });
  } catch (err) {
    console.error('[VPSHub] Update repo error:', err.message);
    res.status(500).json({ error: 'Failed to update repository' });
  }
});

// Delete repository
router.delete('/repos/:owner/:repo', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    if (repo.owner_id !== req.admin.id) {
      return res.status(403).json({ error: 'Not the repository owner' });
    }

    await gitService.deleteRepository(pool, repo.id, repo.owner_username, repo.slug);
    res.json({ message: 'Repository deleted' });
  } catch (err) {
    console.error('[VPSHub] Delete repo error:', err.message);
    res.status(500).json({ error: 'Failed to delete repository' });
  }
});

// ─── Code Browsing ───────────────────────────────────────────

// Get file tree
router.get('/repos/:owner/:repo/tree/:ref/*', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const dirPath = req.params[0] || '';
    const tree = await gitService.getTree(repo.owner_username, repo.slug, req.params.ref, dirPath);
    res.json({ tree });
  } catch (err) {
    console.error('[VPSHub] Tree error:', err.message);
    res.status(500).json({ error: 'Failed to get file tree' });
  }
});

// Get tree at root
router.get('/repos/:owner/:repo/tree/:ref', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const tree = await gitService.getTree(repo.owner_username, repo.slug, req.params.ref, '');
    res.json({ tree });
  } catch (err) {
    console.error('[VPSHub] Tree error:', err.message);
    res.status(500).json({ error: 'Failed to get file tree' });
  }
});

// Get file content (blob)
router.get('/repos/:owner/:repo/blob/:ref/*', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const filePath = req.params[0];
    const content = await gitService.getBlob(repo.owner_username, repo.slug, req.params.ref, filePath);
    if (content === null) return res.status(404).json({ error: 'File not found' });
    res.json({ content, path: filePath });
  } catch (err) {
    console.error('[VPSHub] Blob error:', err.message);
    res.status(500).json({ error: 'Failed to get file content' });
  }
});

// Get commit log
router.get('/repos/:owner/:repo/commits/:ref', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const commits = await gitService.getLog(repo.owner_username, repo.slug, req.params.ref, { limit, offset });
    const total = await gitService.getCommitCount(repo.owner_username, repo.slug, req.params.ref);
    res.json({ commits, total });
  } catch (err) {
    console.error('[VPSHub] Commits error:', err.message);
    res.status(500).json({ error: 'Failed to get commits' });
  }
});

// Get single commit
router.get('/repos/:owner/:repo/commit/:sha', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const commit = await gitService.getCommit(repo.owner_username, repo.slug, req.params.sha);
    if (!commit) return res.status(404).json({ error: 'Commit not found' });
    res.json({ commit });
  } catch (err) {
    console.error('[VPSHub] Commit error:', err.message);
    res.status(500).json({ error: 'Failed to get commit' });
  }
});

// Get branches
router.get('/repos/:owner/:repo/branches', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const branches = await gitService.getBranches(repo.owner_username, repo.slug);
    res.json({ branches });
  } catch (err) {
    console.error('[VPSHub] Branches error:', err.message);
    res.status(500).json({ error: 'Failed to get branches' });
  }
});

// Get tags
router.get('/repos/:owner/:repo/tags', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const tags = await gitService.getTags(repo.owner_username, repo.slug);
    res.json({ tags });
  } catch (err) {
    console.error('[VPSHub] Tags error:', err.message);
    res.status(500).json({ error: 'Failed to get tags' });
  }
});

// Get README
router.get('/repos/:owner/:repo/readme/:ref', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const readme = await gitService.getReadme(repo.owner_username, repo.slug, req.params.ref);
    if (!readme) return res.json({ readme: null });
    res.json({ readme });
  } catch (err) {
    console.error('[VPSHub] README error:', err.message);
    res.status(500).json({ error: 'Failed to get README' });
  }
});

// ─── Personal Access Tokens ──────────────────────────────────

router.get('/tokens', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const tokens = await authService.listTokens(pool, req.admin.id);
    res.json({ tokens });
  } catch (err) {
    console.error('[VPSHub] List tokens error:', err.message);
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

router.post('/tokens', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name } = req.body;

    if (!name || name.length < 1) {
      return res.status(400).json({ error: 'Token name is required' });
    }

    const result = await authService.createToken(pool, req.admin.id, name, ['repo']);
    res.status(201).json(result);
  } catch (err) {
    console.error('[VPSHub] Create token error:', err.message);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

router.delete('/tokens/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const deleted = await authService.revokeToken(pool, req.params.id, req.admin.id);
    if (!deleted) return res.status(404).json({ error: 'Token not found' });
    res.json({ message: 'Token revoked' });
  } catch (err) {
    console.error('[VPSHub] Revoke token error:', err.message);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

module.exports = router;
