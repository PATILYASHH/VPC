const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const syncService = require('../services/syncService');
const pullService = require('../services/pullService');
const banadbService = require('../services/banadbService');

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

// GET /projects/:id/migrations — list migrations
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

// GET /projects/:id/migrations/:mid — single migration
router.get('/projects/:id/migrations/:mid', resolveProject, async (req, res) => {
  try {
    const migration = await syncService.getMigration(req.app.locals.pool, req.params.mid);
    if (!migration) return res.status(404).json({ error: 'Migration not found' });
    res.json(migration);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/changes — pending schema changes
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

// POST /projects/:id/migrations — create migration from pending changes
router.post('/projects/:id/migrations', resolveProject, async (req, res) => {
  try {
    const { sinceId, sql, name } = req.body;

    let migration;
    if (sql) {
      // Manual SQL provided
      migration = await syncService.createMigration(req.app.locals.pool, {
        projectId: req.project.id,
        sqlUp: sql,
        name: name || undefined,
        source: 'manual',
        appliedBy: req.admin?.username || 'vpshub',
      });
    } else {
      // Create from pending changes
      const result = await syncService.createMigrationFromChanges(
        req.app.locals.pool, req.project, {
          sinceId: parseInt(sinceId) || 0,
          appliedBy: req.admin?.username || 'vpshub',
        }
      );
      if (!result) return res.json({ message: 'No pending changes' });
      migration = result.migration;
    }

    res.status(201).json(migration);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/migrations/:mid/push — apply migration
router.post('/projects/:id/migrations/:mid/push', resolveProject, async (req, res) => {
  try {
    const result = await syncService.pushMigration(req.app.locals.pool, req.project, req.params.mid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/migrations/:mid/rollback — rollback migration
router.post('/projects/:id/migrations/:mid/rollback', resolveProject, async (req, res) => {
  try {
    const result = await syncService.rollbackMigration(req.app.locals.pool, req.project, req.params.mid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/schema — current schema snapshot
router.get('/projects/:id/schema', resolveProject, async (req, res) => {
  try {
    const projectPool = banadbService.getProjectPool(req.project);
    const snapshot = await syncService.getSchemaSnapshot(projectPool);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /extension/download — download VS Code extension .vsix
router.get('/extension/download', (req, res) => {
  const vsixPath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync.vsix');
  if (!fs.existsSync(vsixPath)) {
    return res.status(404).json({ error: 'Extension file not available' });
  }
  res.download(vsixPath, 'vpc-sync.vsix');
});

module.exports = router;
