const express = require('express');
const bcrypt = require('bcryptjs');
const { verifyTOTP } = require('../utils/totp');
const { signToken, verifyToken } = require('../utils/jwt');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = email || username;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const pool = req.app.locals.pool;

    const { rows } = await pool.query(
      `SELECT id, username, email, display_name, password_hash, totp_enabled, totp_secret
       FROM vpc_admins WHERE (email = $1 OR username = $1) AND is_active = true`,
      [identifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // If TOTP is enabled, return a temp token for the second step
    if (admin.totp_enabled) {
      const tempToken = signToken(
        { id: admin.id, username: admin.username, purpose: 'totp-challenge' },
        '5m'
      );
      return res.json({ requireTotp: true, tempToken });
    }

    // No TOTP — issue real JWT
    const token = signToken({ id: admin.id, username: admin.username });

    await pool.query(
      'UPDATE vpc_admins SET last_login_at = NOW() WHERE id = $1',
      [admin.id]
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        display_name: admin.display_name,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/login/totp', loginLimiter, async (req, res) => {
  try {
    const { tempToken, totpCode } = req.body;

    if (!tempToken || !totpCode) {
      return res.status(400).json({ error: 'Temporary token and TOTP code are required' });
    }

    let decoded;
    try {
      decoded = verifyToken(tempToken);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired temporary token' });
    }

    if (decoded.purpose !== 'totp-challenge') {
      return res.status(401).json({ error: 'Invalid token purpose' });
    }

    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, username, email, display_name, totp_secret FROM vpc_admins WHERE id = $1 AND is_active = true',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const admin = rows[0];
    const isValid = verifyTOTP(admin.totp_secret, totpCode);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid TOTP code' });
    }

    const token = signToken({ id: admin.id, username: admin.username });

    await pool.query(
      'UPDATE vpc_admins SET last_login_at = NOW() WHERE id = $1',
      [admin.id]
    );

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        display_name: admin.display_name,
      },
    });
  } catch (error) {
    console.error('[Auth] TOTP login error:', error.message);
    res.status(500).json({ error: 'TOTP verification failed' });
  }
});

module.exports = router;
