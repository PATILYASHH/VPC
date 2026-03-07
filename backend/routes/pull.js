const express = require('express');
const router = express.Router();
const { banaApiAuth } = require('../middleware/banaApiAuth');
const pullService = require('../services/pullService');

// All routes require API key auth
router.use(banaApiAuth);

// Middleware: ensure key is a pull key
function requirePullKey(req, res, next) {
  if (req.banaKeyRole !== 'pull') {
    return res.status(403).json({ error: 'This endpoint requires a pull key' });
  }
  next();
}

// GET /:slug/pull/status — tracking status + pending count
router.get('/:slug/pull/status', requirePullKey, async (req, res) => {
  try {
    const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
    const totalChanges = await pullService.getTotalChangeCount(req.banaPool);

    res.json({
      tracking_enabled: req.banaProject.pull_tracking_enabled || false,
      total_changes: totalChanges,
      cursor: cursor?.last_change_id || 0,
      pending_changes: totalChanges - (cursor?.last_change_id || 0),
      last_pulled_at: cursor?.last_pulled_at || null,
      project: {
        name: req.banaProject.name,
        slug: req.banaProject.slug,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:slug/pull/changes — raw schema changes since cursor
router.get('/:slug/pull/changes', requirePullKey, async (req, res) => {
  try {
    const sinceId = parseInt(req.query.since_id) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 500, 1000);

    let effectiveSinceId = sinceId;
    if (!req.query.since_id) {
      const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
      effectiveSinceId = cursor?.last_change_id || 0;
    }

    const result = await pullService.getSchemaChanges(req.banaPool, effectiveSinceId, limit);

    res.json({
      changes: result.changes,
      latest_id: result.latest_id,
      has_more: result.has_more,
      since_id: effectiveSinceId,
      project: {
        name: req.banaProject.name,
        slug: req.banaProject.slug,
      },
    });
  } catch (err) {
    if (err.message && err.message.includes('_vpc_schema_changes')) {
      return res.status(404).json({
        error: 'Pull tracking is not enabled for this project. Enable it in the dashboard.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// GET /:slug/pull/migration — formatted migration file for pending changes
router.get('/:slug/pull/migration', requirePullKey, async (req, res) => {
  try {
    const cursor = await pullService.getPullCursor(req.app.locals.pool, req.banaApiKeyId);
    const sinceId = cursor?.last_change_id || 0;

    const result = await pullService.getSchemaChanges(req.banaPool, sinceId, 5000);

    if (result.changes.length === 0) {
      return res.json({ migration: null, message: 'No new changes since last pull' });
    }

    const seqNum = sinceId + 1;
    const migration = pullService.generateMigrationFile(result.changes, seqNum);

    res.json({
      migration,
      change_count: result.changes.length,
      latest_id: result.latest_id,
      has_more: result.has_more,
    });
  } catch (err) {
    if (err.message && err.message.includes('_vpc_schema_changes')) {
      return res.status(404).json({
        error: 'Pull tracking is not enabled for this project. Enable it in the dashboard.',
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /:slug/pull/ack — acknowledge successful pull, advance cursor
router.post('/:slug/pull/ack', requirePullKey, async (req, res) => {
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

module.exports = router;
