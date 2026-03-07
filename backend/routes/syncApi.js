const express = require('express');
const router = express.Router();
const { banaApiAuth } = require('../middleware/banaApiAuth');
const pullService = require('../services/pullService');
const syncService = require('../services/syncService');

// All routes require API key auth (pull key)
router.use(banaApiAuth);

function requirePullKey(req, res, next) {
  if (req.banaKeyRole !== 'pull') {
    return res.status(403).json({ error: 'This endpoint requires a pull key' });
  }
  next();
}

// GET /:slug/sync/status — project sync status + pending change count
router.get('/:slug/sync/status', requirePullKey, async (req, res) => {
  try {
    const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
    const totalChanges = await pullService.getTotalChangeCount(req.banaPool);
    const { migrations, total } = await syncService.getMigrations(
      req.app.locals.pool, req.banaProject.id, { limit: 1 }
    );

    res.json({
      tracking_enabled: req.banaProject.pull_tracking_enabled || false,
      total_changes: totalChanges,
      cursor: cursor?.last_change_id || 0,
      pending_changes: totalChanges - (cursor?.last_change_id || 0),
      last_pulled_at: cursor?.last_pulled_at || null,
      total_migrations: total,
      latest_migration: migrations[0] || null,
      project: {
        name: req.banaProject.name,
        slug: req.banaProject.slug,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:slug/sync/changes — pending changes since cursor
router.get('/:slug/sync/changes', requirePullKey, async (req, res) => {
  try {
    const sinceId = parseInt(req.query.since_id) || 0;
    let effectiveSinceId = sinceId;
    if (!req.query.since_id) {
      const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
      effectiveSinceId = cursor?.last_change_id || 0;
    }

    const result = await pullService.getSchemaChanges(req.banaPool, effectiveSinceId);
    res.json({ ...result, since_id: effectiveSinceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:slug/sync/pull — pull: create migration from pending changes, return SQL
router.post('/:slug/sync/pull', requirePullKey, async (req, res) => {
  try {
    const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
    const sinceId = cursor?.last_change_id || 0;

    const result = await syncService.createMigrationFromChanges(
      req.app.locals.pool, req.banaProject, {
        sinceId,
        appliedBy: 'vpcsync',
      }
    );

    if (!result) {
      return res.json({ migration: null, message: 'No pending changes' });
    }

    // Advance cursor
    await pullService.updatePullCursor(
      req.app.locals.pool,
      req.banaApiKeyId,
      req.banaProject.id,
      result.latest_id
    );

    res.json({
      migration: result.migration,
      change_count: result.change_count,
      cursor: result.latest_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:slug/sync/push — push: receive SQL, apply to DB, record migration
router.post('/:slug/sync/push', requirePullKey, async (req, res) => {
  try {
    const { sql, name } = req.body;
    if (!sql) return res.status(400).json({ error: 'sql is required' });

    // Create migration record
    const migration = await syncService.createMigration(req.app.locals.pool, {
      projectId: req.banaProject.id,
      sqlUp: sql,
      name,
      source: 'push',
      appliedBy: 'vpcsync',
    });

    // Apply it
    const result = await syncService.pushMigration(
      req.app.locals.pool, req.banaProject, migration.id
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:slug/sync/ack — acknowledge pull (advance cursor)
router.post('/:slug/sync/ack', requirePullKey, async (req, res) => {
  try {
    const { change_id } = req.body;
    if (!change_id || typeof change_id !== 'number') {
      return res.status(400).json({ error: 'change_id (number) is required' });
    }

    await pullService.updatePullCursor(
      req.app.locals.pool,
      req.banaApiKeyId,
      req.banaProject.id,
      change_id
    );

    res.json({ acknowledged: true, cursor: change_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:slug/sync/migrations — list migration history
router.get('/:slug/sync/migrations', requirePullKey, async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await syncService.getMigrations(req.app.locals.pool, req.banaProject.id, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
