// Public GitHub webhook endpoint for PR previews. NO admin auth — verified
// by HMAC SHA-256 against the project's previews_webhook_secret.
//
// Mounted at: /api/webhooks/github
// Endpoint:   POST /wh/:projectId
//
// We mount our own JSON parser here with a `verify` callback so we can capture
// the raw body for HMAC verification BEFORE express.json mutates req.body.

const express = require('express');
const router = express.Router();
const previewService = require('../services/webHostingPreviewService');
const webHostingService = require('../services/webHostingService');

// Capture raw body for HMAC verification
router.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

router.post('/wh/:projectId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const projectId = req.params.projectId;
    const event = req.headers['x-github-event'] || '';
    const signature = req.headers['x-hub-signature-256'] || '';

    // Lookup project + secret
    const { rows } = await pool.query(
      `SELECT * FROM web_hosting_projects WHERE id = $1`,
      [projectId]
    );
    const project = rows[0];
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.previews_enabled || !project.previews_webhook_secret) {
      return res.status(403).json({ error: 'Previews are disabled for this project' });
    }

    // Verify HMAC
    const ok = previewService.verifySignature(project.previews_webhook_secret, signature, req.rawBody);
    if (!ok) return res.status(401).json({ error: 'Bad signature' });

    // Ack the ping event
    if (event === 'ping') return res.json({ ok: true, ping: true });

    // Build the public host URL for the preview
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const host = `${proto}://${hostHeader}`;

    const result = await previewService.handleEvent(pool, project, event, req.body, host);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[preview-webhook] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
