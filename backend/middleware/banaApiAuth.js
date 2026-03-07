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

    // Attach project, role, and key ID
    req.banaProject = result;
    req.banaKeyRole = result.role;
    req.banaApiKeyId = result.api_key_id;
    req.banaPool = banadbService.getProjectPool(result);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Middleware to enforce per-project storage limits on write operations
async function banaStorageCheck(req, res, next) {
  try {
    const check = await banadbService.checkStorageLimit(req.app.locals.pool, req.banaProject);
    if (check.exceeded) {
      return res.status(507).json({
        error: `Storage limit exceeded. Used ${check.used_mb} MB of ${check.limit_mb} MB allocated. Upgrade your storage limit or delete data.`,
        storage: check,
      });
    }
    next();
  } catch {
    next(); // Don't block on check failure
  }
}

module.exports = { banaApiAuth, banaStorageCheck };
