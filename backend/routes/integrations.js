const express = require('express');
const router = express.Router();
const integrationService = require('../services/integrationService');

// List all integrations
router.get('/', async (req, res) => {
  try {
    const integrations = await integrationService.getAll(req.app.locals.pool);
    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get integration type definitions (for frontend form generation)
router.get('/types', (req, res) => {
  res.json({ types: integrationService.INTEGRATION_TYPES });
});

// Create integration
router.post('/', async (req, res) => {
  try {
    const { type, name, config, credentials } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'Type and name are required' });

    const integration = await integrationService.create(req.app.locals.pool, {
      type, name, config, credentials,
    });
    res.status(201).json({ integration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update integration
router.put('/:id', async (req, res) => {
  try {
    const { name, config, credentials } = req.body;
    const integration = await integrationService.update(req.app.locals.pool, req.params.id, {
      name, config, credentials,
    });
    if (!integration) return res.status(404).json({ error: 'Integration not found' });
    res.json({ integration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete integration
router.delete('/:id', async (req, res) => {
  try {
    await integrationService.remove(req.app.locals.pool, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await integrationService.testConnection(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy: monitoring stats from integration_stats table
router.get('/stats', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(`
      SELECT s.*,
        COALESCE(json_agg(
          json_build_object('hour', h.hour_start, 'requests', h.request_count, 'errors', h.error_count, 'avg_ms', h.avg_response_ms)
          ORDER BY h.hour_start
        ) FILTER (WHERE h.id IS NOT NULL), '[]') AS hourly_stats
      FROM integration_stats s
      LEFT JOIN integration_stats_hourly h ON h.integration_id = s.id AND h.hour_start >= NOW() - INTERVAL '24 hours'
      GROUP BY s.id ORDER BY s.system_name
    `);
    res.json({ stats: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
