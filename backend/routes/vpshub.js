const express = require('express');
const router = express.Router();
const multer = require('multer');
const gitService = require('../services/vpshubGitService');
const authService = require('../services/vpshubAuthService');
const prService = require('../services/vpshubPrService');
const issueService = require('../services/vpshubIssueService');
const deployService = require('../services/vpshubDeployService');
const tgBot = require('../services/jarvisTelegramService');

// Multer memory storage for file uploads (files go into VCS, not disk)
// No file size limit, no file count limit — users can drop entire projects
const uploadStorage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024, files: 5000 }, // 500MB per file, 5000 files max
});

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

    const title = req.body.title;
    const description = req.body.description;
    const sourceBranch = req.body.sourceBranch || req.body.source_branch;
    const targetBranch = req.body.targetBranch || req.body.target_branch;
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

    tgBot.alertPRCreated(repo.name, pr.pr_number, pr.title).catch(() => {});
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
      tgBot.alertPRMerged(repo.name, pr.pr_number, pr.title).catch(() => {});
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

// List available DB projects to link
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

// Link repo to DB project
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

// ─── VPC Sync Downloads ──────────────────────────────────────

router.get('/downloads/cli', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync-cli.tar.gz');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'CLI package not available' });
  }
  res.download(filePath, 'vpc-sync-cli.tar.gz');
});

router.get('/downloads/extension', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync.vsix');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Extension file not available' });
  }
  res.download(filePath, 'vpc-sync.vsix');
});

router.get('/downloads/info', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  const cliPath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync-cli.tar.gz');
  const vsixPath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync.vsix');

  res.json({
    cli: {
      version: '1.0.0',
      filename: 'vpc-sync-cli.tar.gz',
      available: fs.existsSync(cliPath),
      size: fs.existsSync(cliPath) ? fs.statSync(cliPath).size : 0,
      downloadUrl: '/downloads/vpc-sync-cli.tar.gz',
    },
    extension: {
      version: '8.0.0',
      filename: 'vpc-sync.vsix',
      available: fs.existsSync(vsixPath),
      size: fs.existsSync(vsixPath) ? fs.statSync(vsixPath).size : 0,
      downloadUrl: '/downloads/vpc-sync.vsix',
    },
  });
});

// ─── Software Upgrade ───────────────────────────────────────

// Check for updates from GitHub
router.get('/system/upgrade-check', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const path = require('path');
    const rootDir = path.join(__dirname, '..', '..');

    // Get current local commit
    const localHash = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
    const localDate = execSync('git log -1 --format=%ci', { cwd: rootDir, encoding: 'utf8' }).trim();
    const localMsg = execSync('git log -1 --format=%s', { cwd: rootDir, encoding: 'utf8' }).trim();
    const localBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();

    // Fetch latest from remote (without merging)
    try {
      execSync('git fetch origin --quiet', { cwd: rootDir, timeout: 15000 });
    } catch (fetchErr) {
      return res.json({
        current: { hash: localHash.slice(0, 12), date: localDate, message: localMsg, branch: localBranch },
        updateAvailable: false,
        error: 'Could not reach GitHub. Check network connection.',
      });
    }

    // Compare local vs remote
    const remoteHash = execSync(`git rev-parse origin/${localBranch}`, { cwd: rootDir, encoding: 'utf8' }).trim();
    const updateAvailable = localHash !== remoteHash;

    let remoteInfo = {};
    let behindCount = 0;
    let newCommits = [];

    if (updateAvailable) {
      const remoteDate = execSync(`git log -1 --format=%ci origin/${localBranch}`, { cwd: rootDir, encoding: 'utf8' }).trim();
      const remoteMsg = execSync(`git log -1 --format=%s origin/${localBranch}`, { cwd: rootDir, encoding: 'utf8' }).trim();
      behindCount = parseInt(execSync(`git rev-list HEAD..origin/${localBranch} --count`, { cwd: rootDir, encoding: 'utf8' }).trim()) || 0;

      // Get list of new commits (max 20)
      const logOutput = execSync(`git log HEAD..origin/${localBranch} --format="%h|%s|%ci|%an" -20`, { cwd: rootDir, encoding: 'utf8' }).trim();
      if (logOutput) {
        newCommits = logOutput.split('\n').map(line => {
          const [hash, message, date, author] = line.split('|');
          return { hash, message, date, author };
        });
      }

      remoteInfo = { hash: remoteHash.slice(0, 12), date: remoteDate, message: remoteMsg };
    }

    // Get repo info
    let repoUrl = '';
    try {
      repoUrl = execSync('git remote get-url origin', { cwd: rootDir, encoding: 'utf8' }).trim();
    } catch {}

    res.json({
      current: { hash: localHash.slice(0, 12), date: localDate, message: localMsg, branch: localBranch },
      remote: updateAvailable ? remoteInfo : null,
      updateAvailable,
      behindCount,
      newCommits,
      repoUrl,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[VPC] Upgrade check error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Apply upgrade — git pull, npm install, rebuild frontend
router.post('/system/upgrade-apply', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const path = require('path');
    const rootDir = path.join(__dirname, '..', '..');
    const branch = req.body.branch || 'main';
    const skipRestart = req.body.skipRestart || false;

    res.json({ started: true, message: skipRestart ? 'Upgrade started. Restart manually when ready.' : 'Upgrade started. Server will restart.' });

    const run = (cmd) => new Promise((resolve, reject) => {
      exec(cmd, { cwd: rootDir, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
        else resolve(stdout);
      });
    });

    try {
      console.log('[VPC Upgrade] Step 1: git pull...');
      await run(`git pull origin ${branch}`);

      console.log('[VPC Upgrade] Step 2: npm install (backend)...');
      await run('cd backend && npm install --production');

      console.log('[VPC Upgrade] Step 3: npm install (frontend)...');
      await run('cd frontend && npm install');

      console.log('[VPC Upgrade] Step 4: build frontend...');
      await run('cd frontend && npx vite build');

      console.log('[VPC Upgrade] Step 5: run migrations...');
      try {
        const fs = require('fs');
        const pool = req.app.locals.pool;
        const migrationsDir = path.join(rootDir, 'backend', 'migrations');
        if (fs.existsSync(migrationsDir)) {
          const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
          for (const file of files) {
            const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
            try { await pool.query(sql); } catch {}
          }
        }
      } catch (migErr) {
        console.error('[VPC Upgrade] Migration warning:', migErr.message);
      }

      if (skipRestart) {
        console.log('[VPC Upgrade] Complete! Waiting for manual restart.');
        // Save state so frontend knows upgrade is done but restart pending
        const pool = req.app.locals.pool;
        await pool.query(
          `INSERT INTO vpc_settings (key, value) VALUES ('upgrade_pending_restart', $1)
           ON CONFLICT (key) DO UPDATE SET value = $1`,
          [JSON.stringify({ upgraded_at: new Date().toISOString(), branch })]
        ).catch(() => {});
      } else {
        console.log('[VPC Upgrade] Complete! Restarting server...');
        setTimeout(() => {
          try { require('child_process').execSync('pm2 restart all', { timeout: 5000 }); }
          catch { process.exit(0); }
        }, 1000);
      }
    } catch (upgradeErr) {
      console.error('[VPC Upgrade] Failed:', upgradeErr.message);
    }
  } catch (err) {
    console.error('[VPC] Upgrade apply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Restart server manually
router.post('/system/restart', async (req, res) => {
  res.json({ restarting: true });
  // Clear pending restart flag
  const pool = req.app.locals.pool;
  await pool.query("DELETE FROM vpc_settings WHERE key = 'upgrade_pending_restart'").catch(() => {});
  setTimeout(() => {
    try { require('child_process').execSync('pm2 restart all', { timeout: 5000 }); }
    catch { process.exit(0); }
  }, 500);
});

// Get/Set auto-upgrade preference
router.get('/system/auto-upgrade', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'auto_upgrade'");
    const settings = rows[0]?.value ? JSON.parse(rows[0].value) : { enabled: false };

    // Check if restart is pending
    const { rows: pendingRows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'upgrade_pending_restart'");
    settings.pendingRestart = !!pendingRows[0];
    if (pendingRows[0]?.value) {
      try { settings.pendingRestartInfo = JSON.parse(pendingRows[0].value); } catch {}
    }

    res.json(settings);
  } catch (err) {
    res.json({ enabled: false });
  }
});

router.post('/system/auto-upgrade', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { enabled } = req.body;
    const value = JSON.stringify({ enabled: !!enabled, updatedAt: new Date().toISOString() });
    await pool.query(
      `INSERT INTO vpc_settings (key, value) VALUES ('auto_upgrade', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [value]
    );
    res.json({ enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Merge Check ────────────────────────────────────────────

const vcsMerge = require('../services/vpcVcsMerge');
const vcsCore = require('../services/vpcVcsCore');

// Check if a PR can merge cleanly (dry run)
router.get('/repos/:owner/:repo/pulls/:number/merge-check', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await loadRepo(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repo.id, parseInt(req.params.number));
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const repoPath = gitService.getRepoPath(repo.owner_username, repo.slug);
    const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.source_branch}`);
    const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.target_branch}`);

    if (!sourceHash || !targetHash) {
      return res.json({ mergeable: false, conflicts: [], error: 'Branch not found' });
    }

    // Dry-run merge — mergeCommits returns { success: false, conflicts } without writing when conflicts exist
    const result = vcsMerge.mergeCommits(repoPath, {
      ours: targetHash, theirs: sourceHash,
      authorName: 'check', authorEmail: 'check@vpshub',
      message: 'merge-check',
    });

    if (result.success) {
      return res.json({ mergeable: true, conflicts: [] });
    }

    res.json({
      mergeable: false,
      conflicts: result.conflicts.map(c => ({
        path: c.path,
        type: c.type,
        conflictCount: c.conflictCount || 1,
      })),
    });
  } catch (err) {
    console.error('[VPSHub] Merge check error:', err.message);
    res.status(500).json({ error: 'Failed to check merge status' });
  }
});

// ─── AI Code Review & Agent ──────────────────────────────────

const aiReviewService = require('../services/aiReviewService');

// AI Review a code PR
router.post('/repos/:owner/:repo/pulls/:number/ai-review', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { owner, repo, number } = req.params;
    const repoInfo = await gitService.getRepositoryBySlug(pool, owner, repo);
    if (!repoInfo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repoInfo.id, parseInt(number));
    if (!pr) return res.status(404).json({ error: 'PR not found' });

    const diff = await prService.getPrDiff(owner, repo, pr.source_branch, pr.target_branch);
    const files = await prService.getPrFiles(owner, repo, pr.source_branch, pr.target_branch);
    const fileList = files.map(f => f.path);

    const result = await aiReviewService.reviewCode(diff, fileList, {
      pool, title: pr.title, description: pr.description,
    });

    if (result.error) return res.status(500).json({ error: result.error });

    // Store review as a PR comment
    if (result.review) {
      const review = result.review;
      const body = `## AI Code Review\n\n**${review.approval === 'approve' ? 'Approved' : review.approval === 'request_changes' ? 'Changes Requested' : 'Reviewed'}**\n\n${review.summary || ''}\n\n${
        review.issues?.length ? '### Issues\n' + review.issues.map(i => `- **${i.severity}** ${i.file}${i.line ? ':' + i.line : ''}: ${i.message}`).join('\n') + '\n\n' : ''
      }${
        review.suggestions?.length ? '### Suggestions\n' + review.suggestions.map(s => `- ${s}`).join('\n') + '\n\n' : ''
      }${
        review.security_concerns?.length ? '### Security Concerns\n' + review.security_concerns.map(s => `- ${s}`).join('\n') + '\n\n' : ''
      }${review.review_notes || ''}`;

      await prService.addComment(pool, {
        repoId: repoInfo.id, prId: pr.id, authorId: req.admin.id, body,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('[VPSHub] AI review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// AI Resolve conflicts in a PR
router.post('/repos/:owner/:repo/pulls/:number/ai-resolve', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { owner, repo, number } = req.params;
    const repoInfo = await gitService.getRepositoryBySlug(pool, owner, repo);
    if (!repoInfo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repoInfo.id, parseInt(number));
    if (!pr) return res.status(404).json({ error: 'PR not found' });

    const repoPath = gitService.getRepoPath(owner, repo);

    // Attempt merge to get conflicts
    const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.source_branch}`);
    const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.target_branch}`);
    if (!sourceHash || !targetHash) return res.status(400).json({ error: 'Branch not found' });

    const mergeResult = vcsMerge.mergeCommits(repoPath, {
      ours: targetHash, theirs: sourceHash,
      authorName: 'AI Agent', authorEmail: 'ai@vpshub',
      message: `AI-resolved merge: ${pr.source_branch} into ${pr.target_branch}`,
    });

    if (mergeResult.success) {
      return res.json({ resolved: true, message: 'No conflicts — merge is clean', merge_sha: mergeResult.commitHash });
    }

    // Resolve each conflict with AI
    const resolutions = [];
    for (const conflict of mergeResult.conflicts) {
      const result = await aiReviewService.resolveConflicts(conflict.content, conflict.path, { pool });
      resolutions.push({ path: conflict.path, ...result });
    }

    res.json({ resolved: false, conflicts: mergeResult.conflicts.length, resolutions });
  } catch (err) {
    console.error('[VPSHub] AI resolve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// VPAI: Auto-resolve conflicts and apply to source branch
router.post('/repos/:owner/:repo/pulls/:number/ai-auto-resolve', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { owner, repo, number } = req.params;
    const repoInfo = await gitService.getRepositoryBySlug(pool, owner, repo);
    if (!repoInfo) return res.status(404).json({ error: 'Repository not found' });

    const pr = await prService.getPullRequest(pool, repoInfo.id, parseInt(number));
    if (!pr) return res.status(404).json({ error: 'PR not found' });
    if (pr.status !== 'open') return res.status(400).json({ error: 'PR is not open' });

    const repoPath = gitService.getRepoPath(owner, repo);

    // Get conflicts via dry-run merge
    const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.source_branch}`);
    const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${pr.target_branch}`);
    if (!sourceHash || !targetHash) return res.status(400).json({ error: 'Branch not found' });

    const mergeResult = vcsMerge.mergeCommits(repoPath, {
      ours: targetHash, theirs: sourceHash,
      authorName: 'VPAI', authorEmail: 'vpai@vpshub',
      message: 'check',
    });

    if (mergeResult.success) {
      return res.json({ resolved: true, message: 'No conflicts — PR is clean', resolutions: [] });
    }

    // Resolve each conflict with AI
    const resolutions = [];
    const resolvedFiles = [];
    const { approved = [] } = req.body; // Optional: list of file paths user approved

    for (const conflict of mergeResult.conflicts) {
      // Skip files not in approved list (if provided)
      if (approved.length > 0 && !approved.includes(conflict.path)) {
        resolutions.push({ path: conflict.path, skipped: true, reason: 'Not approved' });
        continue;
      }

      try {
        const result = await aiReviewService.resolveConflicts(conflict.content, conflict.path, { pool });
        if (result.error) {
          resolutions.push({ path: conflict.path, skipped: true, reason: result.error });
          continue;
        }

        const resolution = result.resolution || result;
        resolutions.push({
          path: conflict.path,
          applied: true,
          strategy: resolution.strategy || 'AI merged both sides',
          confidence: resolution.confidence || 'medium',
          plain_summary: resolution.plain_summary || resolution.strategy || '',
        });
        resolvedFiles.push({
          path: conflict.path,
          content: resolution.resolved_content,
        });
      } catch (aiErr) {
        resolutions.push({ path: conflict.path, skipped: true, reason: aiErr.message });
      }
    }

    // Apply resolved files to source branch
    if (resolvedFiles.length > 0) {
      await prService.applyResolvedFiles(pool, {
        repoId: repoInfo.id,
        repoPath,
        sourceBranch: pr.source_branch,
        resolvedFiles,
        authorName: 'VPAI',
      });

      // Add summary comment to PR
      const summary = resolutions
        .filter(r => r.applied)
        .map(r => `- **${r.path}**: ${r.plain_summary || r.strategy}`)
        .join('\n');

      await prService.addComment(pool, {
        repoId: repoInfo.id, prId: pr.id, authorId: req.admin.id,
        body: `## VPAI Auto-Resolution\n\nResolved ${resolvedFiles.length} conflict(s):\n\n${summary}\n\n*Review the changes and merge when ready.*`,
      });
    }

    res.json({
      resolved: resolvedFiles.length === mergeResult.conflicts.length,
      total_conflicts: mergeResult.conflicts.length,
      applied: resolvedFiles.length,
      skipped: mergeResult.conflicts.length - resolvedFiles.length,
      resolutions,
    });
  } catch (err) {
    console.error('[VPSHub] VPAI auto-resolve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// AI Agent chat for a repository
router.post('/repos/:owner/:repo/agent/chat', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { owner, repo } = req.params;
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const repoInfo = await gitService.getRepositoryBySlug(pool, owner, repo);
    if (!repoInfo) return res.status(404).json({ error: 'Repository not found' });

    const repoPath = gitService.getRepoPath(owner, repo);

    // Build repo context
    let fileTree = '';
    let recentCommits = '';
    try {
      const headHash = vcsCore.resolveRef(repoPath, 'HEAD');
      if (headHash) {
        const commit = vcsCore.readCommit(repoPath, headHash);
        const files = vcsCore.walkTree(repoPath, commit.tree);
        fileTree = files.slice(0, 100).map(f => f.path).join('\n');

        // Recent commits
        const commits = [];
        let hash = headHash;
        for (let i = 0; i < 10 && hash; i++) {
          try {
            const c = vcsCore.readCommit(repoPath, hash);
            commits.push(`${hash.slice(0, 8)} ${c.message}`);
            hash = c.parents[0] || null;
          } catch { break; }
        }
        recentCommits = commits.join('\n');
      }
    } catch { /* ignore */ }

    const result = await aiReviewService.chatWithRepo(message, {
      repoName: `${owner}/${repoInfo.slug}`,
      branch: 'main',
      fileTree,
      recentCommits,
      history: history || [],
    }, { pool });

    res.json(result);
  } catch (err) {
    console.error('[VPSHub] Agent chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// AI Agent analyze repository
router.post('/repos/:owner/:repo/agent/analyze', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { owner, repo } = req.params;
    const repoInfo = await gitService.getRepositoryBySlug(pool, owner, repo);
    if (!repoInfo) return res.status(404).json({ error: 'Repository not found' });

    const repoPath = gitService.getRepoPath(owner, repo);

    // Get file listing and key files content
    let fileTree = '';
    let keyFilesContent = '';
    try {
      const headHash = vcsCore.resolveRef(repoPath, 'HEAD');
      if (headHash) {
        const commit = vcsCore.readCommit(repoPath, headHash);
        const files = vcsCore.walkTree(repoPath, commit.tree);
        fileTree = files.map(f => `${f.path} (${f.size}b)`).join('\n');

        // Read key files for analysis
        const keyFiles = ['package.json', 'README.md', 'Dockerfile', '.env.example', 'requirements.txt', 'go.mod', 'Cargo.toml'];
        for (const kf of keyFiles) {
          const match = files.find(f => f.path.endsWith(kf));
          if (match) {
            try {
              const content = vcsCore.readBlob(repoPath, match.hash).toString('utf8');
              keyFilesContent += `\n--- ${match.path} ---\n${content.slice(0, 2000)}\n`;
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* ignore */ }

    const message = `Analyze this repository comprehensively. Cover:
1. Project overview — what does it do?
2. Tech stack and dependencies
3. Code quality observations
4. Potential issues or improvements
5. Security concerns
6. Suggestions for next steps

File structure:\n${fileTree.slice(0, 5000)}\n\nKey files:\n${keyFilesContent.slice(0, 8000)}`;

    const result = await aiReviewService.chatWithRepo(message, {
      repoName: `${owner}/${repoInfo.slug}`,
      branch: 'main',
    }, { pool });

    res.json(result);
  } catch (err) {
    console.error('[VPSHub] Agent analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── File Upload / Drop ─────────────────────────────────────

// Upload files directly to a repo branch
// Preview upload — shows what files are new/modified before saving
router.post('/repos/:owner/:repo/preview-upload', uploadStorage.array('files', 200), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const branch = req.body.branch || 'main';
    const basePath = req.body.basePath || '';

    const uploadedFiles = (req.files || []).map(f => {
      const filePath = basePath ? `${basePath}/${f.originalname}` : f.originalname;
      return { path: filePath, content: f.buffer };
    });

    const preview = gitService.previewUpload(repo.owner_username, repo.slug, branch, uploadedFiles);

    // Get user's last download to check for server-side changes
    const lastDownload = await gitService.getLastDownload(pool, repo.id, req.admin.id, branch);

    res.json({
      ...preview,
      lastDownload: lastDownload ? {
        commitHash: lastDownload.commit_hash,
        downloadedAt: lastDownload.downloaded_at,
        serverChanged: preview.currentCommit !== lastDownload.commit_hash,
      } : null,
      summary: `${preview.newFiles.length} new, ${preview.modifiedFiles.length} updated, ${preview.unchangedFiles.length} unchanged`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to preview: ' + err.message });
  }
});

// Regular upload
router.post('/repos/:owner/:repo/upload', uploadStorage.array('files', 200), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const branch = req.body.branch || 'main';
    const commitMessage = req.body.message || `Upload ${req.files.length} file(s) via drop`;
    const basePath = req.body.basePath || ''; // optional subfolder prefix

    // Build file entries preserving relative paths
    const files = req.files.map(f => {
      // Use webkitRelativePath from body if available, otherwise originalname
      const relativePath = f.originalname;
      const filePath = basePath ? `${basePath}/${relativePath}` : relativePath;
      return { path: filePath, content: f.buffer };
    });

    const result = await gitService.uploadFiles(
      pool, repo.id, repo.owner_username, repo.slug,
      branch, files, commitMessage, req.admin.username
    );

    res.json({
      message: `${result.filesCount} file(s) saved successfully!`,
      commitHash: result.commitHash,
      filesCount: result.filesCount,
    });
  } catch (err) {
    console.error('[VPSHub] Upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload files: ' + err.message });
  }
});

// AI review & fix uploaded code
router.post('/repos/:owner/:repo/ai-review-fix', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const aiReviewService = require('../services/aiReviewService');
    const { requirements, branch } = req.body;
    const ref = branch || 'main';

    // Get all files in the repo
    const manifest = await gitService.getFileManifest(repo.owner_username, repo.slug, ref);
    if (!manifest || manifest.length === 0) {
      return res.status(400).json({ error: 'No files in repository to review' });
    }

    // Read content of key code files (skip binaries, large files)
    const codeExtensions = /\.(js|jsx|ts|tsx|py|java|go|rs|rb|php|html|css|scss|json|yaml|yml|md|sql|sh|c|cpp|h|vue|svelte|dart|kt|swift)$/i;
    let codeContent = '';
    let fileCount = 0;

    for (const file of manifest) {
      if (fileCount >= 50) break; // limit to 50 files
      if (!codeExtensions.test(file.path)) continue;
      if (file.size > 100000) continue; // skip files > 100KB

      try {
        const content = await gitService.getBlob(repo.owner_username, repo.slug, ref, file.path);
        if (content) {
          codeContent += `\n--- ${file.path} ---\n${content}\n`;
          fileCount++;
        }
      } catch { /* skip unreadable */ }
    }

    const prompt = `You are a senior code reviewer. Review the following codebase and provide:

1. **Issues Found**: List bugs, security issues, bad practices
2. **Fixes Applied**: For each issue, provide the exact fixed code
3. **Structure Suggestions**: How to organize the code better
4. **Missing Files**: Any config files, .gitignore, README that should be added

${requirements ? `\n**User Requirements:**\n${requirements}\n\nMake sure the code meets these requirements. Suggest or fix code accordingly.` : ''}

**Repository:** ${req.params.owner}/${repo.slug}
**Files (${fileCount}):**
${codeContent.slice(0, 15000)}

Respond in clean markdown. For fixes, show the file path and the corrected code block.`;

    const result = await aiReviewService.chatWithRepo(prompt, {
      repoName: `${req.params.owner}/${repo.slug}`,
      branch: ref,
    }, { pool });

    res.json(result);
  } catch (err) {
    console.error('[VPSHub] AI review-fix error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// AI auto-fix: apply Claude's fixes directly to the repo
router.post('/repos/:owner/:repo/ai-auto-fix', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const repo = await gitService.getRepositoryBySlug(pool, req.params.owner, req.params.repo);
    if (!repo) return res.status(404).json({ error: 'Repository not found' });

    const aiReviewService = require('../services/aiReviewService');
    const { requirements, branch } = req.body;
    const ref = branch || 'main';

    // Get all code files
    const manifest = await gitService.getFileManifest(repo.owner_username, repo.slug, ref);
    const codeExtensions = /\.(js|jsx|ts|tsx|py|java|go|rs|rb|php|html|css|scss|json|yaml|yml|md|sql|sh|c|cpp|h|vue|svelte|dart|kt|swift)$/i;
    let codeContent = '';
    let fileCount = 0;
    const fileContents = {};

    for (const file of manifest) {
      if (fileCount >= 40) break;
      if (!codeExtensions.test(file.path)) continue;
      if (file.size > 100000) continue;

      try {
        const content = await gitService.getBlob(repo.owner_username, repo.slug, ref, file.path);
        if (content) {
          codeContent += `\n--- ${file.path} ---\n${content}\n`;
          fileContents[file.path] = content;
          fileCount++;
        }
      } catch { /* skip */ }
    }

    const prompt = `You are an expert code fixer. Review and fix the following code.
${requirements ? `\n**Requirements:** ${requirements}\n` : ''}

IMPORTANT: Return your response as a JSON object with this exact format:
{
  "fixes": [
    { "path": "file/path.js", "content": "entire fixed file content here" }
  ],
  "summary": "Brief summary of what was fixed",
  "newFiles": [
    { "path": "file/path.js", "content": "content for new files if needed" }
  ]
}

Only include files that actually need changes. Return the COMPLETE file content, not just the changed parts.

**Repository:** ${req.params.owner}/${repo.slug}
**Files:**
${codeContent.slice(0, 15000)}`;

    const result = await aiReviewService.chatWithRepo(prompt, {
      repoName: `${req.params.owner}/${repo.slug}`,
      branch: ref,
    }, { pool });

    // Parse AI response and apply fixes
    let fixes = [];
    let summary = 'AI reviewed and fixed code';
    let newFiles = [];

    try {
      const responseText = result.response || result.message || '';
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                        responseText.match(/(\{[\s\S]*"fixes"[\s\S]*\})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        fixes = parsed.fixes || [];
        summary = parsed.summary || summary;
        newFiles = parsed.newFiles || [];
      }
    } catch {
      // If AI didn't return valid JSON, just return the review
      return res.json({
        applied: false,
        message: 'AI provided review but fixes could not be auto-applied',
        review: result.response || result.message,
      });
    }

    if (fixes.length === 0 && newFiles.length === 0) {
      return res.json({ applied: false, message: 'No fixes needed', review: result.response });
    }

    // Apply fixes as a new commit
    const allFiles = [...fixes, ...newFiles].map(f => ({
      path: f.path,
      content: Buffer.from(f.content),
    }));

    const commitResult = await gitService.uploadFiles(
      pool, repo.id, repo.owner_username, repo.slug,
      ref, allFiles, `AI auto-fix: ${summary}`, 'VPAI'
    );

    res.json({
      applied: true,
      message: summary,
      filesFixed: fixes.length,
      newFilesCreated: newFiles.length,
      commitHash: commitResult.commitHash,
    });
  } catch (err) {
    console.error('[VPSHub] AI auto-fix error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Unified Project (Repo + Database + Sync in one click) ──

router.post('/unified-project', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, description, includeDatabase, enableSync, visibility } = req.body;

    if (!name || name.trim().length < 1) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const slug = slugify(name);
    const results = { repo: null, database: null, syncEnabled: false };

    // Step 1: Create the repository
    const repo = await gitService.createRepository(pool, {
      name: name.trim(),
      slug,
      description: description || '',
      visibility: visibility || 'private',
      ownerId: req.admin.id,
      ownerUsername: req.admin.username,
      initReadme: true,
    });
    results.repo = { id: repo.id, name: repo.name, slug: repo.slug };

    // Step 2: Create DB project (if requested)
    if (includeDatabase !== false) {
      try {
        const dbService = require('../services/dbService');
        const dbProject = await dbService.createProject(pool, {
          name: `${name.trim()} DB`,
          slug: `${slug}-db`,
          createdBy: req.admin.id,
        });
        results.database = { id: dbProject.id, name: dbProject.name, slug: dbProject.slug };

        // Link repo to database
        await deployService.linkRepoToProject(pool, repo.id, dbProject.id);

        // Step 3: Enable sync tracking (if requested)
        if (enableSync !== false) {
          try {
            const pullService = require('../services/pullService');
            await pullService.installTracking(pool, dbProject.id);
            results.syncEnabled = true;
          } catch (syncErr) {
            console.error('[VPSHub] Sync tracking setup failed:', syncErr.message);
          }
        }
      } catch (dbErr) {
        console.error('[VPSHub] Database creation in unified project failed:', dbErr.message);
        results.databaseError = dbErr.message;
      }
    }

    res.status(201).json({
      message: 'Project created successfully!',
      ...results,
    });
  } catch (err) {
    console.error('[VPSHub] Unified project creation error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create project' });
  }
});

// List all projects with their linked database and hosting info
router.get('/projects-overview', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(`
      SELECT r.*,
        a.username as owner_username,
        bp.id as db_id, bp.name as db_name, bp.slug as db_slug, bp.status as db_status,
        wh.id as hosting_id, wh.name as hosting_name, wh.slug as hosting_slug, wh.status as hosting_status
      FROM vpshub_repositories r
      JOIN vpc_admins a ON a.id = r.owner_id
      LEFT JOIN db_projects bp ON bp.id = r.linked_project_id
      LEFT JOIN web_hosting_projects wh ON wh.id = r.linked_hosting_id
      WHERE r.owner_id = $1
      ORDER BY r.updated_at DESC
    `, [req.admin.id]);

    res.json(rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      owner: r.owner_username,
      visibility: r.visibility,
      updatedAt: r.updated_at,
      database: r.db_id ? { id: r.db_id, name: r.db_name, slug: r.db_slug, status: r.db_status } : null,
      hosting: r.hosting_id ? { id: r.hosting_id, name: r.hosting_name, slug: r.hosting_slug, status: r.hosting_status } : null,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load projects overview' });
  }
});

module.exports = router;
