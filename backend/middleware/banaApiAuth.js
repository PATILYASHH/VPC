const crypto = require('crypto');
const banadbService = require('../services/banadbService');

async function banaApiAuth(req, res, next) {
  const apiKey = req.headers['apikey'] || req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing apikey header' });
  }

  try {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await banadbService.findProjectByApiKeyHash(req.app.locals.pool, keyHash);

    if (!result) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    // Attach project and role
    req.banaProject = result;
    req.banaKeyRole = result.role;
    req.banaPool = banadbService.getProjectPool(result);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = banaApiAuth;
