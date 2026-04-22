/**
 * VPC Device-Flow Auth — GitHub-style sign-in for VS Code extension.
 *
 * Flow:
 *   1. Extension POSTs /code → gets {device_code, user_code, verification_uri}
 *   2. Extension opens browser at verification_uri?code=<user_code>
 *   3. User (already logged in) clicks Approve → /confirm (JWT auth)
 *   4. Extension polls /token with device_code → receives PAT + server info
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const { createToken } = require('../services/vpshubAuthService');

const DEVICE_CODE_TTL_SECONDS = 15 * 60; // 15 minutes
const POLL_INTERVAL_SECONDS = 3;

function genDeviceCode() {
  return crypto.randomBytes(32).toString('hex');
}

function genUserCode() {
  // 8 chars, uppercase, human-friendly (no 0/O/1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code.slice(0, 4) + '-' + code.slice(4);
}

// ─── PUBLIC: start device authorization ──────────────────────────
// POST /api/admin/auth/device/code
router.post('/code', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const clientName = (req.body && req.body.client_name) || 'VS Code Extension';

    const deviceCode = genDeviceCode();
    const userCode = genUserCode();
    const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000);

    await pool.query(
      `INSERT INTO vpc_device_codes (device_code, user_code, client_name, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [deviceCode, userCode, clientName, expiresAt]
    );

    const host = req.get('host');
    const proto = req.protocol;
    const base = `${proto}://${host}`;

    res.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${base}/auth/device`,
      verification_uri_complete: `${base}/auth/device?code=${userCode}`,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
      server_url: base,
    });
  } catch (err) {
    console.error('[DeviceAuth] code error:', err.message);
    res.status(500).json({ error: 'Failed to create device code' });
  }
});

// ─── PUBLIC: poll for token ──────────────────────────────────────
// POST /api/admin/auth/device/token   { device_code }
router.post('/token', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { device_code } = req.body || {};
    if (!device_code) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const { rows } = await pool.query(
      `SELECT d.*, a.username, a.email, a.display_name, t.id AS token_id
       FROM vpc_device_codes d
       LEFT JOIN vpc_admins a ON a.id = d.user_id
       LEFT JOIN vpshub_tokens t ON t.id = d.issued_token_id
       WHERE d.device_code = $1`,
      [device_code]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'invalid_device_code' });
    }

    const row = rows[0];

    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: 'expired_token' });
    }

    if (row.status === 'pending') {
      return res.status(202).json({ error: 'authorization_pending' });
    }

    if (row.status === 'denied') {
      return res.status(403).json({ error: 'access_denied' });
    }

    // status === 'approved' but we only deliver the plaintext PAT once.
    // We stash it in a transient column (plaintext_once) that is cleared after read.
    const { rows: secret } = await pool.query(
      `SELECT plaintext_once FROM vpc_device_codes WHERE id = $1`,
      [row.id]
    );

    const pat = secret[0] && secret[0].plaintext_once;
    if (!pat) {
      return res.status(410).json({ error: 'token_already_delivered' });
    }

    // Clear the plaintext token so it can't be fetched twice.
    await pool.query(
      `UPDATE vpc_device_codes SET plaintext_once = NULL WHERE id = $1`,
      [row.id]
    );

    const host = req.get('host');
    const proto = req.protocol;

    res.json({
      access_token: pat,
      token_type: 'vpshub_pat',
      username: row.username,
      email: row.email,
      display_name: row.display_name,
      server_url: `${proto}://${host}`,
    });
  } catch (err) {
    console.error('[DeviceAuth] token error:', err.message);
    res.status(500).json({ error: 'Failed to exchange device code' });
  }
});

// ─── AUTHED: approval screen lookup ──────────────────────────────
// GET /api/admin/auth/device/pending?code=XXXX-XXXX
router.get('/pending', authenticateAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const code = (req.query.code || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'code required' });

    const { rows } = await pool.query(
      `SELECT user_code, client_name, status, expires_at FROM vpc_device_codes WHERE user_code = $1`,
      [code]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const row = rows[0];
    const expired = new Date(row.expires_at) < new Date();

    res.json({
      user_code: row.user_code,
      client_name: row.client_name,
      status: expired ? 'expired' : row.status,
      expires_at: row.expires_at,
    });
  } catch (err) {
    console.error('[DeviceAuth] pending error:', err.message);
    res.status(500).json({ error: 'Failed to fetch device code' });
  }
});

// ─── AUTHED: approve (and mint PAT) ──────────────────────────────
// POST /api/admin/auth/device/confirm   { user_code }
router.post('/confirm', authenticateAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const code = ((req.body && req.body.user_code) || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'user_code required' });

    const { rows } = await pool.query(
      `SELECT id, status, expires_at FROM vpc_device_codes WHERE user_code = $1`,
      [code]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) {
      return res.status(410).json({ error: 'expired' });
    }
    if (row.status === 'approved') {
      return res.status(409).json({ error: 'already_approved' });
    }
    if (row.status === 'denied') {
      return res.status(409).json({ error: 'denied' });
    }

    // Mint a PAT tied to this admin
    const tokenName = `VS Code Sign-In (${new Date().toISOString().slice(0, 10)})`;
    const tokenRow = await createToken(pool, req.admin.id, tokenName, ['repo', 'sync']);

    await pool.query(
      `UPDATE vpc_device_codes
       SET status = 'approved', user_id = $1, issued_token_id = $2,
           approved_at = NOW(), plaintext_once = $3
       WHERE id = $4`,
      [req.admin.id, tokenRow.id, tokenRow.token, row.id]
    );

    res.json({ ok: true, user_code: code });
  } catch (err) {
    console.error('[DeviceAuth] confirm error:', err.message);
    res.status(500).json({ error: 'Failed to confirm device code' });
  }
});

// ─── AUTHED: deny ────────────────────────────────────────────────
// POST /api/admin/auth/device/deny   { user_code }
router.post('/deny', authenticateAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const code = ((req.body && req.body.user_code) || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'user_code required' });

    await pool.query(
      `UPDATE vpc_device_codes SET status = 'denied' WHERE user_code = $1 AND status = 'pending'`,
      [code]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[DeviceAuth] deny error:', err.message);
    res.status(500).json({ error: 'Failed to deny device code' });
  }
});

module.exports = router;
