const crypto = require('crypto');
const dbService = require('../services/dbService');

async function dbApiAuth(req, res, next) {
  const apiKey = req.headers['apikey'] || req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing apikey header' });
  }

  try {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const result = await dbService.findProjectByApiKeyHash(req.app.locals.pool, keyHash);

    if (!result) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    // Attach project, role, and key ID
    req.dbProject = result;
    req.dbKeyRole = result.role;
    req.dbApiKeyId = result.api_key_id;
    req.dbPool = dbService.getProjectPool(result);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Middleware to enforce per-project storage limits on write operations
async function dbStorageCheck(req, res, next) {
  try {
    const check = await dbService.checkStorageLimit(req.app.locals.pool, req.dbProject);
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

module.exports = { dbApiAuth, dbStorageCheck };
