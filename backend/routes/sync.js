const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const syncService = require('../services/syncService');
const pullService = require('../services/pullService');
const banadbService = require('../services/banadbService');
const prService = require('../services/prService');

/**
 * Resolve project by ID and attach to req.
 */
async function resolveProject(req, res, next) {
  try {
    const project = await banadbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    req.project = project;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Summary (landing page) ────────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(`
      SELECT project_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_prs,
        COUNT(*) FILTER (WHERE status = 'merged') AS merged_prs,
        COUNT(*) FILTER (WHERE status = 'conflict') AS conflict_prs
      FROM vpc_pull_requests GROUP BY project_id
    `);
    res.json({ summaries: rows });
  } catch (err) {
    // Table may not exist yet
    res.json({ summaries: [] });
  }
});

// ─── Pull Requests ─────────────────────────────────────────

router.get('/projects/:id/pull-requests', resolveProject, async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const result = await prService.getPullRequests(req.app.locals.pool, req.project.id, {
      status,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/pull-requests/:num', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });
    res.json(pr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests', resolveProject, async (req, res) => {
  try {
    const { title, description, sql_content } = req.body;
    if (!title || !sql_content) return res.status(400).json({ error: 'title and sql_content are required' });

    const pr = await prService.createPullRequest(req.app.locals.pool, {
      projectId: req.project.id,
      title,
      description,
      sqlContent: sql_content,
      submittedBy: req.admin?.username || 'vpshub',
    });
    res.status(201).json(pr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/test', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.testPullRequest(req.app.locals.pool, req.project, pr.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/merge', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.mergePullRequest(
      req.app.locals.pool, req.project, pr.id, req.admin?.username || 'vpshub'
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/close', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.closePullRequest(req.app.locals.pool, pr.id, req.admin?.username || 'vpshub');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/reopen', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.reopenPullRequest(req.app.locals.pool, pr.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tracking Management ───────────────────────────────────

router.post('/projects/:id/tracking/reinstall', resolveProject, async (req, res) => {
  try {
    await pullService.installPullTracking(req.app.locals.pool, req.project);
    res.json({ success: true, message: 'DDL tracking reinstalled with SECURITY DEFINER' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/tracking/status', resolveProject, async (req, res) => {
  try {
    const status = await pullService.getPullTrackingStatus(req.app.locals.pool, req.project);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Migrations ────────────────────────────────────────────

router.get('/projects/:id/migrations', resolveProject, async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const result = await syncService.getMigrations(req.app.locals.pool, req.project.id, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
      status,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/migrations/:mid', resolveProject, async (req, res) => {
  try {
    const migration = await syncService.getMigration(req.app.locals.pool, req.params.mid);
    if (!migration) return res.status(404).json({ error: 'Migration not found' });
    res.json(migration);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/migrations/:mid/rollback', resolveProject, async (req, res) => {
  try {
    const result = await syncService.rollbackMigration(req.app.locals.pool, req.project, req.params.mid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/changes', resolveProject, async (req, res) => {
  try {
    if (!req.project.pull_tracking_enabled) {
      return res.json({ changes: [], total: 0, tracking_enabled: false });
    }
    const projectPool = banadbService.getProjectPool(req.project);
    const sinceId = parseInt(req.query.since) || 0;
    const result = await pullService.getSchemaChanges(projectPool, sinceId);
    res.json({ ...result, tracking_enabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/schema', resolveProject, async (req, res) => {
  try {
    const projectPool = banadbService.getProjectPool(req.project);
    const snapshot = await syncService.getSchemaSnapshot(projectPool);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Extension Download ────────────────────────────────────

router.get('/extension/download', (req, res) => {
  const vsixPath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync.vsix');
  if (!fs.existsSync(vsixPath)) {
    return res.status(404).json({ error: 'Extension file not available' });
  }
  res.download(vsixPath, 'vpc-sync.vsix');
});

module.exports = router;
