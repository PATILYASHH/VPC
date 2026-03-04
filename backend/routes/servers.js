const express = require('express');
const pm2Service = require('../services/pm2Service');
const systemService = require('../services/systemService');
const { ALLOWED_SERVICES, SERVICE_MAP } = require('../utils/whitelist');

const router = express.Router();

// GET /api/admin/servers - List all services and system metrics
router.get('/', async (req, res) => {
  try {
    const [processes, system] = await Promise.allSettled([
      pm2Service.list(),
      Promise.resolve(systemService.getMetrics()),
    ]);

    let diskUsage = [];
    try {
      diskUsage = await systemService.getDiskUsage();
    } catch {
      // Disk usage may not be available on all platforms
    }

    res.json({
      processes: processes.status === 'fulfilled' ? processes.value : [],
      system: system.status === 'fulfilled' ? system.value : {},
      disk: diskUsage,
      pm2_error: processes.status === 'rejected' ? processes.reason.message : null,
    });
  } catch (error) {
    console.error('[Servers] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch server status' });
  }
});

// POST /api/admin/server/restart - Restart a whitelisted service
router.post('/restart', async (req, res) => {
  try {
    const { service } = req.body;

    if (!service || !ALLOWED_SERVICES.includes(service)) {
      return res.status(400).json({
        error: `Service "${service}" is not allowed. Allowed: ${ALLOWED_SERVICES.join(', ')}`,
      });
    }

    const serviceConfig = SERVICE_MAP[service];
    let result;

    if (serviceConfig.type === 'pm2') {
      result = await pm2Service.restart(serviceConfig.processName);
    } else if (serviceConfig.type === 'system') {
      result = await systemService.restartSystemService(serviceConfig.serviceName);
    }

    res.json(result);
  } catch (error) {
    console.error('[Servers] Restart error:', error.message);
    res.status(500).json({ error: `Failed to restart service: ${error.message}` });
  }
});

module.exports = router;
