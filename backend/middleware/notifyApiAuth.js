const crypto = require('crypto');
const notifyService = require('../services/notifyService');

async function notifyApiAuth(req, res, next) {
  const apiKey = req.headers['apikey'] || req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing apikey header' });
  }

  try {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await notifyService.findProjectByApiKeyHash(req.app.locals.pool, keyHash);

    if (!result) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    req.notifyProject = result;
    req.notifyKeyRole = result.role;
    req.notifyApiKeyId = result.api_key_id;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// server-role keys only — required for /send and delivery-status reads
function requireServerKey(req, res, next) {
  if (req.notifyKeyRole !== 'server') {
    return res.status(403).json({ error: 'This endpoint requires a server key' });
  }
  next();
}

module.exports = { notifyApiAuth, requireServerKey };
