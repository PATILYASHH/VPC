const express = require('express');
const router = express.Router();
const { notifyApiAuth, requireServerKey } = require('../middleware/notifyApiAuth');
const notifyService = require('../services/notifyService');

// All routes require a notify API key (client or server — checked per-route below)
router.use(notifyApiAuth);

// ─── Devices (client key) ─────────────────────────────────────

router.post('/devices/register', async (req, res) => {
  try {
    const { device_id, platform, app_version, sdk_version, os_version, device_model } = req.body;
    const device = await notifyService.registerDevice(req.app.locals.pool, req.notifyProject, {
      deviceId: device_id, platform, appVersion: app_version, sdkVersion: sdk_version, osVersion: os_version, deviceModel: device_model,
    });
    res.status(201).json({ device_id: device.device_id, push_token: device.push_token, status: device.status });
  } catch (err) {
    if (err.code === 'DEVICE_LIMIT_REACHED') return res.status(403).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

router.post('/devices/:device_id/heartbeat', async (req, res) => {
  try {
    const device = await notifyService.heartbeatDevice(req.app.locals.pool, req.notifyProject.id, req.params.device_id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true, last_seen_at: device.last_seen_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/devices/:device_id', async (req, res) => {
  try {
    const result = await notifyService.unregisterDevice(req.app.locals.pool, req.notifyProject.id, req.params.device_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/devices/:device_id/topics', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic is required' });
    const result = await notifyService.subscribeTopic(req.app.locals.pool, req.notifyProject.id, req.params.device_id, topic);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/devices/:device_id/topics/:topic', async (req, res) => {
  try {
    const result = await notifyService.unsubscribeTopic(req.app.locals.pool, req.notifyProject.id, req.params.device_id, req.params.topic);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Devices (server key) ─────────────────────────────────────

router.get('/devices', requireServerKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const result = await notifyService.getDevices(req.app.locals.pool, req.notifyProject.id, { limit, offset });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Send (server key only) ────────────────────────────────────

router.post('/send', requireServerKey, async (req, res) => {
  try {
    const { target, title, body, data, priority, ttl_seconds, collapse_key } = req.body;
    const message = await notifyService.sendMessage(req.app.locals.pool, req.notifyProject, req.notifyApiKeyId, {
      target, title, body, data, priority, ttlSeconds: ttl_seconds, collapseKey: collapse_key,
    });
    res.status(202).json({ message_id: message.id, target_device_count: message.target_device_count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/messages/:message_id', requireServerKey, async (req, res) => {
  try {
    const message = await notifyService.getMessage(req.app.locals.pool, req.notifyProject.id, req.params.message_id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/messages/:message_id/deliveries', requireServerKey, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const deliveries = await notifyService.getMessageDeliveries(req.app.locals.pool, req.params.message_id, { limit, offset });
    res.json({ deliveries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
