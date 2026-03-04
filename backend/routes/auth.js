const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken } = require('../utils/jwt');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || username.length > 100) {
      return res.status(400).json({ error: 'Invalid username' });
    }

    const pool = req.app.locals.pool;

    const { rows } = await pool.query(
      'SELECT id, username, email, display_name, password_hash FROM vpc_admins WHERE username = $1 AND is_active = true',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin = rows[0];
    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
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
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
