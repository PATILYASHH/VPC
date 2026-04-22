const express = require('express');
const router = express.Router();
const upgrade = require('../services/upgradeService');

// GET /api/admin/upgrade/status
router.get('/status', async (req, res) => {
  try {
    const s = await upgrade.status(req.app.locals.pool);
    res.json(s);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/upgrade/restart
// Exits the Node process so PM2/systemd relaunches with fresh on-disk code.
router.post('/restart', async (req, res) => {
  try {
    await upgrade.clearPending(req.app.locals.pool);
    res.json({ ok: true, message: 'Process exiting — supervisor should relaunch within a few seconds.' });
    upgrade.requestRestart({ delayMs: 400 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/upgrade/acknowledge — dismiss the pending banner without restarting
router.post('/acknowledge', async (req, res) => {
  try {
    await upgrade.clearPending(req.app.locals.pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
