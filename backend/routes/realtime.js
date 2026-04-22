// Server-Sent Events stream for the desktop realtime layer.
// Clients connect to GET /api/admin/realtime?channels=metrics,jobs,notifications
// and receive newline-delimited SSE events.

const express = require('express');
const bus = require('../services/realtimeBus');
const systemService = require('../services/systemService');

const router = express.Router();

router.get('/', (req, res) => {
  const channelsParam = String(req.query.channels || '*');
  const subscribed = new Set(channelsParam.split(',').map((c) => c.trim()).filter(Boolean));

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (msg) => {
    try {
      res.write(`event: ${msg.channel}\n`);
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    } catch {}
  };

  const client = { subscribed, send };
  const unregister = bus.addClient(client);

  // Greet
  send({ channel: 'hello', payload: { ts: Date.now(), channels: [...subscribed] }, ts: Date.now() });

  // Heartbeat every 25s to keep the connection alive through proxies
  const hb = setInterval(() => {
    try { res.write(': ping\n\n'); } catch {}
  }, 25000);

  // Push live metrics every 5s if subscribed
  let metricsTimer = null;
  if (subscribed.has('metrics') || subscribed.has('*')) {
    const pushMetrics = async () => {
      try {
        const sys = systemService.getMetrics();
        let disk = null;
        try {
          const list = await systemService.getDiskUsage();
          disk = list?.[0] || null;
        } catch {}
        send({ channel: 'metrics', payload: { sys, disk }, ts: Date.now() });
      } catch {}
    };
    pushMetrics();
    metricsTimer = setInterval(pushMetrics, 5000);
  }

  req.on('close', () => {
    clearInterval(hb);
    if (metricsTimer) clearInterval(metricsTimer);
    unregister();
    try { res.end(); } catch {}
  });
});

module.exports = router;
