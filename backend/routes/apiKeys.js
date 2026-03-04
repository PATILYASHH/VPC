const express = require('express');
const crypto = require('crypto');

const router = express.Router();

// GET /api/admin/api-keys
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, permissions, is_active, expires_at,
              last_used_at, total_requests, rate_limit_per_minute, created_at
       FROM api_keys ORDER BY created_at DESC`
    );
    res.json({ keys: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/api-keys
router.post('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, permissions, expires_at, rate_limit_per_minute } = req.body;

    if (!name) return res.status(400).json({ error: 'Name is required' });

    // Generate API key
    const rawKey = 'vpc_' + crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.slice(4, 16); // first 12 chars after vpc_
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const { rows } = await pool.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, permissions, expires_at, rate_limit_per_minute, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, key_prefix, permissions, is_active, created_at`,
      [name, keyPrefix, keyHash, JSON.stringify(permissions || {}), expires_at || null, rate_limit_per_minute || 60, req.admin.id]
    );

    res.status(201).json({
      ...rows[0],
      api_key: rawKey, // Only shown once
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/api-keys/:id (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'UPDATE api_keys SET is_active = false, updated_at = NOW() WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'API key revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/api-keys/:id/usage
router.get('/:id/usage', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT * FROM api_key_usage_logs WHERE api_key_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
