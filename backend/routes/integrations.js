const express = require('express');
const router = express.Router();
const integrationService = require('../services/integrationService');

// List all integrations visible to the current admin
// (shared ones + ones they own privately)
router.get('/', async (req, res) => {
  try {
    const integrations = await integrationService.getAll(req.app.locals.pool, { forUserId: req.admin?.id });
    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List integrations of one type (used by IntegrationPicker)
router.get('/by-type/:type', async (req, res) => {
  try {
    const integrations = await integrationService.getByType(req.app.locals.pool, req.params.type);
    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get the default integration for a type
router.get('/default/:type', async (req, res) => {
  try {
    const integration = await integrationService.getDefault(req.app.locals.pool, req.params.type);
    res.json({ integration: integration || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promote integration to default for its type
router.post('/:id/default', async (req, res) => {
  try {
    const integration = await integrationService.setDefault(req.app.locals.pool, req.params.id);
    res.json({ integration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reverse-lookup: which apps reference an integration
router.get('/:id/uses', async (req, res) => {
  try {
    const uses = await integrationService.listUses(req.app.locals.pool, { integrationId: req.params.id });
    res.json({ uses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggregate uses across all integrations
router.get('/uses/all', async (req, res) => {
  try {
    const uses = await integrationService.listUses(req.app.locals.pool);
    res.json({ uses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Proxy: any app can call these without ever asking the user for a token ──

const credentialResolver = require('../services/credentialResolver');

// GET /api/admin/integrations/proxy/github/repos — list the connected user's repos
router.get('/proxy/github/repos', async (req, res, next) => {
  try {
    const { integration, credentials } = await credentialResolver.require(
      req.app.locals.pool, 'github',
      { app: req.query.app || 'unknown' }
    );
    const r = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: { Authorization: `token ${credentials.token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return res.status(r.status).json({ error: `GitHub: ${r.status}` });
    const repos = await r.json();
    res.json({ integration: { id: integration.id, name: integration.name }, repos });
  } catch (err) { next(err); }
});

// GET /api/admin/integrations/proxy/github/me — current GitHub identity
router.get('/proxy/github/me', async (req, res, next) => {
  try {
    const { integration, credentials } = await credentialResolver.require(
      req.app.locals.pool, 'github',
      { app: req.query.app || 'unknown' }
    );
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${credentials.token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return res.status(r.status).json({ error: `GitHub: ${r.status}` });
    const user = await r.json();
    res.json({ integration: { id: integration.id, name: integration.name }, user });
  } catch (err) { next(err); }
});

// POST /api/admin/integrations/proxy/notify — broadcast a message to default Slack/Discord
router.post('/proxy/notify', async (req, res, next) => {
  try {
    const { message, channels = ['slack', 'discord'] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const results = {};
    for (const ch of channels) {
      try {
        const resolved = await credentialResolver.resolve(
          req.app.locals.pool, ch, { app: req.query.app || 'unknown' }
        );
        if (!resolved) { results[ch] = { ok: false, error: 'not connected' }; continue; }
        const url = resolved.credentials.webhookUrl;
        const body = ch === 'slack' ? { text: message } : { content: message };
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        results[ch] = { ok: r.ok, status: r.status };
      } catch (err) { results[ch] = { ok: false, error: err.message }; }
    }
    res.json({ results });
  } catch (err) { next(err); }
});

// Get integration type definitions (for frontend form generation)
router.get('/types', (req, res) => {
  res.json({ types: integrationService.INTEGRATION_TYPES });
});

// Create integration
router.post('/', async (req, res) => {
  try {
    const { type, name, config, credentials, visibility } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'Type and name are required' });

    const integration = await integrationService.create(req.app.locals.pool, {
      type, name, config, credentials, visibility,
      createdBy: req.admin?.id,
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

// ─── One-click automations ─────────────────────────────────────
const automations = require('../services/integrationAutomations');

// GET /api/admin/integrations/automations — full registry
router.get('/automations', (req, res) => {
  res.json({ automations: automations.AUTOMATIONS ? Object.keys(automations.AUTOMATIONS) : [] });
});

// POST /api/admin/integrations/:id/automate   { automation, options }
router.post('/:id/automate', async (req, res) => {
  try {
    const { automation, options } = req.body || {};
    if (!automation) return res.status(400).json({ error: 'automation required' });
    const result = await automations.runAutomation(
      req.app.locals.pool,
      req.params.id,
      automation,
      { ...(options || {}), ownerId: req.admin.id }
    );
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
