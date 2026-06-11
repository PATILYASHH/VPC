const crypto = require('crypto');

// In-memory per-key rate limiting (resets every minute)
const rateBuckets = new Map();

function checkRateLimit(keyId, limit) {
  const now = Date.now();
  const bucket = rateBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60000) {
    rateBuckets.set(keyId, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

// Authenticates agent API keys (vpcbot_xxx) sent via Authorization: Bearer
// or x-api-key header. Attaches req.agentKey with permissions + store_history.
async function agentApiAuth(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '').trim();
    } else if (req.headers['x-api-key']) {
      token = String(req.headers['x-api-key']).trim();
    }

    if (!token || (!token.startsWith('vpcbot_') && !token.startsWith('vpccli_'))) {
      return res.status(401).json({ error: 'Agent API key required (Authorization: Bearer vpcbot_.../vpccli_... or x-api-key header)' });
    }

    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT * FROM agent_api_keys WHERE key_hash = $1 AND is_active = true',
      [keyHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    const key = rows[0];
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    if (!checkRateLimit(key.id, key.rate_limit_per_minute || 30)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' });
    }

    // Usage metadata only (request count + timestamp) — never message content
    pool.query(
      'UPDATE agent_api_keys SET last_used_at = NOW(), total_requests = total_requests + 1 WHERE id = $1',
      [key.id]
    ).catch(() => {});

    req.agentKey = key;
    next();
  } catch (err) {
    console.error('[AgentApiAuth] Error:', err.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = agentApiAuth;
