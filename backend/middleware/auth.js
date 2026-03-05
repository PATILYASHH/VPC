const { verifyToken } = require('../utils/jwt');

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
      'SELECT id, username, email, display_name, allowed_ips FROM vpc_admins WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Admin account not found or inactive' });
    }

    req.admin = rows[0];
    next();
  } catch (error) {
    console.error('[Auth] Authentication error:', error.message);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

module.exports = { authenticateAdmin };
