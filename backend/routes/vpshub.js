const express = require('express');
const router = express.Router();
const gitService = require('../services/vpshubGitService');
const authService = require('../services/vpshubAuthService');
const prService = require('../services/vpshubPrService');
const issueService = require('../services/vpshubIssueService');
const deployService = require('../services/vpshubDeployService');

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

// ─── Extension Sync (Full Repo File Manifest) ───────────────

// Get full file manifest with hashes (for extension to compare local vs remote)
router.get('/repos/:owner/:repo/manifest/:ref', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const headSha = await gitService.getHeadSha(repo.owner_username, repo.slug, req.params.ref);
    const files = await gitService.getFileManifest(repo.owner_username, repo.slug, req.params.ref);

    res.json({ ref: req.params.ref, sha: headSha, files, total: files.length });
  } catch (err) {
    console.error('[VPSHub] Manifest error:', err.message);
    res.status(500).json({ error: 'Failed to get file manifest' });
  }
});

// Download raw file content (binary-safe)
router.get('/repos/:owner/:repo/raw/:ref/*', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const filePath = req.params[0];
    const buffer = await gitService.getBlobRaw(repo.owner_username, repo.slug, req.params.ref, filePath);
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Get changed files between two commits
router.get('/repos/:owner/:repo/changes/:from/:to', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const changes = await gitService.getChangedFiles(
      repo.owner_username, repo.slug, req.params.from, req.params.to
    );
    res.json({ changes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get changes' });
  }
});

// ─── Pull Requests ────────────────────────────────────────────

// Helper to load repo by owner/slug
async function loadRepo(pool, owner, repoSlug) {
  return gitService.getRepositoryBySlug(pool, owner, repoSlug);
}

// List PRs
router.get('/repos/:owner/:repo/pulls', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const status = req.query.status || 'open';
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const prs = await prService.listPullRequests(pool, repo.id, { status, limit, offset });
    const openCount = await prService.getPrCount(pool, repo.id, 'open');
    const closedCount = await prService.getPrCount(pool, repo.id, 'closed');
    const mergedCount = await prService.getPrCount(pool, repo.id, 'merged');
    res.json({ pulls: prs, counts: { open: openCount, closed: closedCount, merged: mergedCount } });
  } catch (err) {
    console.error('[VPSHub] List PRs error:', err.message);
    res.status(500).json({ error: 'Failed to list pull requests' });
  }
});

// Create PR
router.post('/repos/:owner/:repo/pulls', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { title, description, sourceBranch, targetBranch } = req.body;
    if (!title || !sourceBranch) {
      return res.status(400).json({ error: 'Title and source branch are required' });
    }

    const pr = await prService.createPullRequest(pool, {
      repoId: repo.id, title, description,
      sourceBranch, targetBranch: targetBranch || repo.default_branch || 'main',
      authorId: req.admin.id,
    });

    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'pr_opened',
      refType: 'pull_request', refId: pr.id, refNumber: pr.pr_number,
      metadata: { title },
    });

    res.status(201).json({ pull: { ...pr, author_username: req.admin.username } });
  } catch (err) {
    console.error('[VPSHub] Create PR error:', err.message);
    res.status(500).json({ error: 'Failed to create pull request' });
  }
});

// Get single PR
router.get('/repos/:owner/:repo/pulls/:number', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });
    res.json({ pull: pr });
  } catch (err) {
    console.error('[VPSHub] Get PR error:', err.message);
    res.status(500).json({ error: 'Failed to get pull request' });
  }
});

// Get PR diff
router.get('/repos/:owner/:repo/pulls/:number/diff', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const diff = await prService.getPrDiff(repo.owner_username, repo.slug, pr.source_branch, pr.target_branch);
    const files = await prService.getPrFiles(repo.owner_username, repo.slug, pr.source_branch, pr.target_branch);
    const commits = await prService.getPrCommits(repo.owner_username, repo.slug, pr.source_branch, pr.target_branch);

    res.json({ diff, files, commits });
  } catch (err) {
    console.error('[VPSHub] PR diff error:', err.message);
    res.status(500).json({ error: 'Failed to get PR diff' });
  }
});

// Merge PR
router.post('/repos/:owner/:repo/pulls/:number/merge', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });
    if (pr.status !== 'open') return res.status(400).json({ error: 'PR is not open' });

    const result = await prService.mergePullRequest(pool, {
      prId: pr.id, repoId: repo.id,
      ownerUsername: repo.owner_username, repoSlug: repo.slug,
      sourceBranch: pr.source_branch, targetBranch: pr.target_branch,
      mergedById: req.admin.id,
    });

    if (result.success) {
      await issueService.logActivity(pool, {
        repoId: repo.id, actorId: req.admin.id, action: 'pr_merged',
        refType: 'pull_request', refId: pr.id, refNumber: pr.pr_number,
        metadata: { merge_sha: result.merge_sha },
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[VPSHub] Merge PR error:', err.message);
    res.status(500).json({ error: 'Failed to merge pull request' });
  }
});

// Close PR
router.post('/repos/:owner/:repo/pulls/:number/close', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const updated = await prService.closePullRequest(pool, pr.id);
    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'pr_closed',
      refType: 'pull_request', refId: pr.id, refNumber: pr.pr_number,
    });
    res.json({ pull: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to close pull request' });
  }
});

// Reopen PR
router.post('/repos/:owner/:repo/pulls/:number/reopen', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const updated = await prService.reopenPullRequest(pool, pr.id);
    res.json({ pull: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reopen pull request' });
  }
});

// PR comments
router.get('/repos/:owner/:repo/pulls/:number/comments', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const comments = await prService.getComments(pool, { prId: pr.id });
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

router.post('/repos/:owner/:repo/pulls/:number/comments', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const { body, filePath, lineNumber } = req.body;
    if (!body) return res.status(400).json({ error: 'Comment body is required' });

    const comment = await prService.addComment(pool, {
      repoId: repo.id, prId: pr.id, authorId: req.admin.id,
      body, filePath, lineNumber,
    });
    res.status(201).json({ comment: { ...comment, author_username: req.admin.username } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ─── Issues ───────────────────────────────────────────────────

// List issues
router.get('/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const status = req.query.status || 'open';
    const label = req.query.label;
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const issues = await issueService.listIssues(pool, repo.id, { status, label, limit, offset });
    const openCount = await issueService.getIssueCount(pool, repo.id, 'open');
    const closedCount = await issueService.getIssueCount(pool, repo.id, 'closed');
    res.json({ issues, counts: { open: openCount, closed: closedCount } });
  } catch (err) {
    console.error('[VPSHub] List issues error:', err.message);
    res.status(500).json({ error: 'Failed to list issues' });
  }
});

// Create issue
router.post('/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { title, body, labels } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const issue = await issueService.createIssue(pool, {
      repoId: repo.id, title, body, authorId: req.admin.id, labels,
    });

    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'issue_opened',
      refType: 'issue', refId: issue.id, refNumber: issue.issue_number,
      metadata: { title },
    });

    res.status(201).json({ issue: { ...issue, author_username: req.admin.username, labels: [], comment_count: 0 } });
  } catch (err) {
    console.error('[VPSHub] Create issue error:', err.message);
    res.status(500).json({ error: 'Failed to create issue' });
  }
});

// Get single issue
router.get('/repos/:owner/:repo/issues/:number', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    res.json({ issue });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get issue' });
  }
});

// Update issue
router.put('/repos/:owner/:repo/issues/:number', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const updated = await issueService.updateIssue(pool, issue.id, req.body);
    res.json({ issue: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update issue' });
  }
});

// Close issue
router.post('/repos/:owner/:repo/issues/:number/close', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const updated = await issueService.closeIssue(pool, issue.id, req.admin.id);
    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'issue_closed',
      refType: 'issue', refId: issue.id, refNumber: issue.issue_number,
    });
    res.json({ issue: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to close issue' });
  }
});

// Reopen issue
router.post('/repos/:owner/:repo/issues/:number/reopen', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const updated = await issueService.reopenIssue(pool, issue.id);
    res.json({ issue: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reopen issue' });
  }
});

// Issue comments
router.get('/repos/:owner/:repo/issues/:number/comments', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const comments = await prService.getComments(pool, { issueId: issue.id });
    res.json({ comments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

router.post('/repos/:owner/:repo/issues/:number/comments', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const issue = await issueService.getIssue(pool, repo.id, parseInt(req.params.number));
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'Comment body is required' });

    const comment = await prService.addComment(pool, {
      repoId: repo.id, issueId: issue.id, authorId: req.admin.id, body,
    });
    res.status(201).json({ comment: { ...comment, author_username: req.admin.username } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ─── Labels ───────────────────────────────────────────────────

router.get('/repos/:owner/:repo/labels', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const labels = await issueService.listLabels(pool, repo.id);
    res.json({ labels });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list labels' });
  }
});

router.post('/repos/:owner/:repo/labels', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { name, color, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Label name is required' });

    const label = await issueService.createLabel(pool, repo.id, { name, color, description });
    res.status(201).json({ label });
  } catch (err) {
    if (err.message.includes('duplicate')) {
      return res.status(409).json({ error: 'Label already exists' });
    }
    res.status(500).json({ error: 'Failed to create label' });
  }
});

router.delete('/repos/:owner/:repo/labels/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    await issueService.deleteLabel(pool, req.params.id, repo.id);
    res.json({ message: 'Label deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete label' });
  }
});

// ─── Activity Feed ────────────────────────────────────────────

router.get('/repos/:owner/:repo/activity', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const activity = await issueService.getActivity(pool, repo.id, { limit, offset });
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get activity' });
  }
});

// ─── Comments (generic delete/update) ─────────────────────────

router.delete('/comments/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const deleted = await prService.deleteComment(pool, req.params.id, req.admin.id);
    if (!deleted) return res.status(404).json({ error: 'Comment not found' });
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

router.put('/comments/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'Comment body is required' });

    const updated = await prService.updateComment(pool, req.params.id, req.admin.id, body);
    if (!updated) return res.status(404).json({ error: 'Comment not found' });
    res.json({ comment: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// ─── Database Linking & Deployments ──────────────────────────

// List available BanaDB projects to link
router.get('/projects', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const projects = await deployService.listProjects(pool);
    res.json({ projects });
  } catch (err) {
    console.error('[VPSHub] List projects error:', err.message);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// Get linked project for a repo
router.get('/repos/:owner/:repo/linked-db', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const project = await deployService.getLinkedProject(pool, repo.id);
    const migrations = project
      ? await deployService.getMigrationStatus(pool, repo.id, project.id)
      : [];
    const detected = await deployService.detectMigrations(
      repo.owner_username, repo.slug,
      await gitService.getDefaultBranch(repo.owner_username, repo.slug)
    );

    res.json({ project, migrations, detected });
  } catch (err) {
    console.error('[VPSHub] Get linked DB error:', err.message);
    res.status(500).json({ error: 'Failed to get linked database' });
  }
});

// Link repo to BanaDB project
router.post('/repos/:owner/:repo/link-db', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { projectId } = req.body;
    if (!projectId) return res.status(400).json({ error: 'Project ID is required' });

    await deployService.linkRepoToProject(pool, repo.id, projectId);
    const project = await deployService.getLinkedProject(pool, repo.id);
    res.json({ project, message: 'Database linked successfully' });
  } catch (err) {
    console.error('[VPSHub] Link DB error:', err.message);
    res.status(500).json({ error: 'Failed to link database' });
  }
});

// Unlink repo from DB
router.post('/repos/:owner/:repo/unlink-db', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    await deployService.unlinkRepo(pool, repo.id);
    res.json({ message: 'Database unlinked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink database' });
  }
});

// Run all pending migrations
router.post('/repos/:owner/:repo/run-migrations', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    if (!repo.linked_project_id) {
      return res.status(400).json({ error: 'No database linked to this repository' });
    }

    const ref = await gitService.getDefaultBranch(repo.owner_username, repo.slug);
    const results = await deployService.runAllMigrations(pool, {
      repoId: repo.id,
      projectId: repo.linked_project_id,
      ownerUsername: repo.owner_username,
      repoSlug: repo.slug,
      ref,
    });

    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'migrations_run',
      metadata: { results },
    });

    res.json({ results });
  } catch (err) {
    console.error('[VPSHub] Run migrations error:', err.message);
    res.status(500).json({ error: 'Failed to run migrations' });
  }
});

// Run a single migration file
router.post('/repos/:owner/:repo/run-migration', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    if (!repo.linked_project_id) {
      return res.status(400).json({ error: 'No database linked' });
    }

    const { filePath, fileHash } = req.body;
    if (!filePath) return res.status(400).json({ error: 'File path is required' });

    const ref = await gitService.getDefaultBranch(repo.owner_username, repo.slug);
    const result = await deployService.runMigration(pool, {
      repoId: repo.id,
      projectId: repo.linked_project_id,
      ownerUsername: repo.owner_username,
      repoSlug: repo.slug,
      ref, filePath, fileHash: fileHash || '',
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to run migration' });
  }
});

// ─── Hosting Integration ──────────────────────────────────────

// List available hosting projects
router.get('/hosting-projects', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const projects = await deployService.listHostingProjects(pool);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list hosting projects' });
  }
});

// Get linked hosting for a repo
router.get('/repos/:owner/:repo/linked-hosting', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const hosting = await deployService.getLinkedHosting(pool, repo.id);
    let status = null;
    if (hosting) {
      status = await deployService.getHostingStatus(pool, hosting.id);
    }
    res.json({ hosting, status });
  } catch (err) {
    console.error('[VPSHub] Get linked hosting error:', err.message);
    res.status(500).json({ error: 'Failed to get linked hosting' });
  }
});

// Create hosting project from repo + link
router.post('/repos/:owner/:repo/create-hosting', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { name, slug, projectType, buildCommand, installCommand, outputDir, nodeEntryPoint, envVars, gitBranch } = req.body;

    const project = await deployService.createHostingFromRepo(pool, {
      repoId: repo.id,
      ownerUsername: repo.owner_username,
      repoSlug: repo.slug,
      name, slug, projectType, buildCommand, installCommand, outputDir, nodeEntryPoint, envVars,
      gitBranch: gitBranch || await gitService.getDefaultBranch(repo.owner_username, repo.slug),
      createdBy: req.admin.id,
    });

    res.status(201).json({ project });
  } catch (err) {
    console.error('[VPSHub] Create hosting error:', err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'A hosting project with this slug already exists' });
    res.status(500).json({ error: err.message || 'Failed to create hosting project' });
  }
});

// Link repo to existing hosting project
router.post('/repos/:owner/:repo/link-hosting', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const { hostingId } = req.body;
    if (!hostingId) return res.status(400).json({ error: 'Hosting project ID is required' });

    await deployService.linkRepoToHosting(pool, repo.id, hostingId);
    const hosting = await deployService.getLinkedHosting(pool, repo.id);
    res.json({ hosting, message: 'Hosting linked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to link hosting' });
  }
});

// Unlink hosting
router.post('/repos/:owner/:repo/unlink-hosting', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    await deployService.unlinkHosting(pool, repo.id);
    res.json({ message: 'Hosting unlinked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink hosting' });
  }
});

// Deploy (initial or redeploy)
router.post('/repos/:owner/:repo/deploy-hosting', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });
    if (!repo.linked_hosting_id) return res.status(400).json({ error: 'No hosting linked' });

    const updated = await deployService.deployHosting(pool, repo.linked_hosting_id);

    await issueService.logActivity(pool, {
      repoId: repo.id, actorId: req.admin.id, action: 'hosting_deployed',
      metadata: { status: updated.status },
    });

    res.json({ project: updated });
  } catch (err) {
    console.error('[VPSHub] Deploy hosting error:', err.message);
    res.status(500).json({ error: err.message || 'Deploy failed' });
  }
});

// Get hosting logs
router.get('/repos/:owner/:repo/hosting-logs', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });
    if (!repo.linked_hosting_id) return res.status(400).json({ error: 'No hosting linked' });

    const lines = parseInt(req.query.lines) || 100;
    const logs = await deployService.getHostingLogs(pool, repo.linked_hosting_id, lines);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

// Hosting process control (start/stop/restart)
router.post('/repos/:owner/:repo/hosting-control', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });
    if (!repo.linked_hosting_id) return res.status(400).json({ error: 'No hosting linked' });

    const webHostingService = require('../services/webHostingService');
    const project = await webHostingService.getProject(pool, repo.linked_hosting_id);
    if (!project) return res.status(404).json({ error: 'Hosting project not found' });

    const { action } = req.body;
    if (action === 'start') await webHostingService.startBackend(pool, project);
    else if (action === 'stop') await webHostingService.stopBackend(pool, project);
    else if (action === 'restart') await webHostingService.restartBackend(pool, project);
    else return res.status(400).json({ error: 'Invalid action. Use start/stop/restart' });

    const status = await deployService.getHostingStatus(pool, repo.linked_hosting_id);
    res.json({ message: `${action} successful`, status });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Control action failed' });
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
