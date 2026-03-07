const { verifyToken } = require('../utils/jwt');

// Map route prefixes to permission keys
const ROUTE_PERMISSION_MAP = {
  '/servers': 'servers',
  '/db': 'databases',
  '/bana': 'banadb',
  '/api-keys': 'api_keys',
  '/integrations': 'integrations',
  '/backup': 'backups',
  '/logs': 'logs',
  '/terminal': 'terminal',
  '/users': 'users',
  '/gallery': 'gallery',
  '/sync': 'banadb',
};

async function authenticateAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token.length < 20) {
      return res.status(401).json({ error: 'Invalid token format' });
    }

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
