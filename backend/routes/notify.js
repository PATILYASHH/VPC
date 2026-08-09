const express = require('express');
const router = express.Router();
const notifyService = require('../services/notifyService');

// ─── Projects ──────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    const projects = await notifyService.getProjects(req.app.locals.pool);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { name, androidPackageName, maxDevices, maxQueuePerDevice, defaultTtlSeconds } = req.body;
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    }

    let slug = req.body.slug || notifyService.generateSlug(name);
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
    if (!slug) return res.status(400).json({ error: 'Could not derive a valid slug from the project name' });

    const project = await notifyService.createProject(req.app.locals.pool, {
      name, slug, androidPackageName, maxDevices, maxQueuePerDevice, defaultTtlSeconds,
      createdBy: req.admin.id,
    });

    res.status(201).json({ project });
  } catch (err) {
    if (err.message.includes('duplicate key') || err.code === '23505') {
      return res.status(409).json({ error: 'A project with this slug already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await notifyService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const stats = await notifyService.getProjectStats(req.app.locals.pool, project.id);
    res.json({ project, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id/settings', async (req, res) => {
  try {
    const project = await notifyService.updateProjectSettings(req.app.locals.pool, req.params.id, req.body);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    if (!req.body.confirm) return res.json({ requiresConfirmation: true });
    const result = await notifyService.deleteProject(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Keys ──────────────────────────────────────────────

router.get('/projects/:id/api-keys', async (req, res) => {
  try {
    const keys = await notifyService.ensureDefaultKeys(req.app.locals.pool, req.params.id);
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys', async (req, res) => {
  try {
    const { name, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });
    const result = await notifyService.createApiKey(req.app.locals.pool, req.params.id, { name, role });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys/regenerate', async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['client', 'server'].includes(role)) {
      return res.status(400).json({ error: 'Role must be client or server' });
    }
    const result = await notifyService.regenerateApiKey(req.app.locals.pool, req.params.id, role);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/api-keys/:keyId', async (req, res) => {
  try {
    const result = await notifyService.revokeApiKey(req.app.locals.pool, req.params.keyId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Devices ───────────────────────────────────────────────

router.get('/projects/:id/devices', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const result = await notifyService.getDevices(req.app.locals.pool, req.params.id, { limit, offset });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/devices/:deviceId', async (req, res) => {
  try {
    const result = await notifyService.unregisterDevice(req.app.locals.pool, req.params.id, req.params.deviceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Compose / Send (dashboard test-send) ───────────────────

router.post('/projects/:id/send', async (req, res) => {
  try {
    const project = await notifyService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { target, title, body, data, priority, ttl_seconds, collapse_key } = req.body;
    const message = await notifyService.sendMessage(req.app.locals.pool, project, null, {
      target, title, body, data, priority, ttlSeconds: ttl_seconds, collapseKey: collapse_key,
    });
    res.status(202).json({ message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/projects/:id/messages', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const messages = await notifyService.getMessages(req.app.locals.pool, req.params.id, { limit, offset });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/messages/:messageId', async (req, res) => {
  try {
    const message = await notifyService.getMessage(req.app.locals.pool, req.params.id, req.params.messageId);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/messages/:messageId/deliveries', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const deliveries = await notifyService.getMessageDeliveries(req.app.locals.pool, req.params.messageId, { limit, offset });
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
