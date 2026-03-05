const express = require('express');
const bcrypt = require('bcryptjs');
const { generateSecret, generateURI, verifyTOTP } = require('../utils/totp');
const QRCode = require('qrcode');

const router = express.Router();

// GET / — list all admins
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, username, email, display_name, is_active, totp_enabled,
              last_login_at, created_at, updated_at
       FROM vpc_admins ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  } catch (error) {
    console.error('[Users] List error:', error.message);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// POST / — create admin
router.post('/', async (req, res) => {
  try {
    const { username, email, password, display_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }
    if (username.length < 3 || username.length > 100) {
      return res.status(400).json({ error: 'Username must be 3-100 characters' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const pool = req.app.locals.pool;
    const password_hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO vpc_admins (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, display_name, is_active, totp_enabled, created_at`,
      [username, email, password_hash, display_name || username]
    );

    res.status(201).json({ user: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('[Users] Create error:', error.message);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /:id — update admin
router.put('/:id', async (req, res) => {
  try {
    const { username, email, display_name, is_active, password } = req.body;
    const pool = req.app.locals.pool;

    const sets = [];
    const values = [];
    let idx = 1;

    if (username !== undefined) { sets.push(`username = $${idx++}`); values.push(username); }
    if (email !== undefined) { sets.push(`email = $${idx++}`); values.push(email); }
    if (display_name !== undefined) { sets.push(`display_name = $${idx++}`); values.push(display_name); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(is_active); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sets.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    sets.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE vpc_admins SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, username, email, display_name, is_active, totp_enabled, updated_at`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    console.error('[Users] Update error:', error.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /:id — soft-deactivate
router.delete('/:id', async (req, res) => {
  try {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const pool = req.app.locals.pool;
    await pool.query(
      'UPDATE vpc_admins SET is_active = false, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'User deactivated' });
  } catch (error) {
    console.error('[Users] Deactivate error:', error.message);
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// POST /:id/totp/setup — generate TOTP secret + QR
router.post('/:id/totp/setup', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, username, email FROM vpc_admins WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    const secret = generateSecret();

    await pool.query(
      'UPDATE vpc_admins SET totp_secret = $1, updated_at = NOW() WHERE id = $2',
      [secret, user.id]
    );

    const otpauthUrl = generateURI({ issuer: 'VPC Control', label: user.email, secret });
    const qrCode = await QRCode.toDataURL(otpauthUrl);

    res.json({ secret, qrCode });
  } catch (error) {
    console.error('[Users] TOTP setup error:', error.message);
    res.status(500).json({ error: 'Failed to setup TOTP' });
  }
});

// POST /:id/totp/verify — verify code and enable TOTP
router.post('/:id/totp/verify', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT id, totp_secret FROM vpc_admins WHERE id = $1',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!rows[0].totp_secret) {
      return res.status(400).json({ error: 'TOTP not set up yet' });
    }

    const isValid = verifyTOTP(rows[0].totp_secret, code);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }

    await pool.query(
      'UPDATE vpc_admins SET totp_enabled = true, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'TOTP enabled successfully' });
  } catch (error) {
    console.error('[Users] TOTP verify error:', error.message);
    res.status(500).json({ error: 'Failed to verify TOTP' });
  }
});

// DELETE /:id/totp — disable TOTP
router.delete('/:id/totp', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'UPDATE vpc_admins SET totp_enabled = false, totp_secret = NULL, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );

    res.json({ message: 'TOTP disabled' });
  } catch (error) {
    console.error('[Users] TOTP disable error:', error.message);
    res.status(500).json({ error: 'Failed to disable TOTP' });
  }
});

module.exports = router;
