const crypto = require('crypto');
const { verifyToken } = require('../utils/jwt');

// Map route prefixes to permission keys
const ROUTE_PERMISSION_MAP = {
  '/servers': 'servers',
  '/db': 'databases',
  '/api-keys': 'api_keys',
  '/integrations': 'integrations',
  '/backup': 'backups',
  '/logs': 'logs',
  '/terminal': 'terminal',
  '/users': 'users',
  '/gallery': 'gallery',
  '/sync': 'db',
  '/web-hosting': 'web_hosting',
  '/settings': 'ai_agent',
  '/vpshub': 'vpshub',
  '/pipeline': 'pipeline',
  '/realtime': 'realtime',
  '/upgrade': 'settings',
};

async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '');
    } else if (req.query && req.query._t) {
      // SSE/EventSource fallback — token via query string
      token = String(req.query._t);
    }
    if (!token) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    if (token.length < 20) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

    // Support VPSHub Personal Access Tokens (vpshub_xxx)
    if (token.startsWith('vpshub_')) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const pool = req.app.locals.pool;
      const { rows } = await pool.query(
        `SELECT a.id, a.username, a.email, a.display_name, a.allowed_ips, a.permissions
         FROM vpshub_tokens t
         JOIN vpc_admins a ON a.id = t.user_id
         WHERE t.token_hash = $1 AND a.is_active = true`,
        [tokenHash]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid or revoked token' });
      }

      const admin = rows[0];
      if (!admin.permissions) admin.permissions = { all: true };
      req.admin = admin;

      // Update last_used_at (fire-and-forget)
      pool.query('UPDATE vpshub_tokens SET last_used_at = NOW() WHERE token_hash = $1', [tokenHash]).catch(() => {});

      return next();
    }

    // Otherwise treat as JWT
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Reject temporary tokens (e.g. TOTP challenge tokens)
    if (decoded.purpose) {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, username, email, display_name, allowed_ips, permissions FROM vpc_admins WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Admin account not found or inactive' });
    }

    const admin = rows[0];
    // Default to all permissions if not set (backwards compatibility)
    if (!admin.permissions) admin.permissions = { all: true };
    req.admin = admin;
    next();
  } catch (error) {
    console.error('[Auth] Authentication error:', error.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Middleware: check if admin has permission for this route
function checkPermission(req, res, next) {
  const perms = req.admin?.permissions;

  // Full access users skip all checks
  if (perms?.all === true) return next();

  // /me endpoint is always allowed
  if (req.path === '/me') return next();

  // Find matching permission key from route
  const routePath = req.path;
  let requiredPerm = null;
  for (const [prefix, perm] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (routePath.startsWith(prefix)) {
      requiredPerm = perm;
      break;
    }
  }

  // If no permission mapping found, allow (safe routes like /me)
  if (!requiredPerm) return next();

  // Check if user has the required permission
  if (perms?.[requiredPerm] === true) return next();

  return res.status(403).json({ error: 'You do not have permission to access this resource' });
}

module.exports = { authenticateAdmin, checkPermission };
