const express = require('express');
const path = require('path');
const fs = require('fs');
const backupService = require('../services/backupService');
const supabaseBackup = require('../services/supabaseBackupService');
const { encrypt } = require('../utils/encryption');

const router = express.Router();

// POST /api/admin/backup/run
router.post('/run', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { database, backup_type, notes } = req.body;

    const result = await backupService.runBackup(pool, {
      database,
      backupType: backup_type || 'full',
      initiatedBy: req.admin.id,
      notes,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/backup/list
router.get('/list', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM backups ORDER BY created_at DESC');
    res.json({ backups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/backup/download/:id
router.get('/download/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: 'Backup not found' });

    const backup = rows[0];
    if (!fs.existsSync(backup.file_path)) {
      return res.status(404).json({ error: 'Backup file not found on disk' });
    }

    res.download(backup.file_path, backup.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/backup/restore/:id
router.post('/restore/:id', async (req, res) => {
  try {
    if (!req.body.confirm) {
      return res.status(400).json({ error: 'Confirmation required. Send { confirm: true }' });
    }

    const pool = req.app.locals.pool;
    const result = await backupService.restore(pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── External destinations (Supabase, etc.) ─────────────────────

// GET /api/admin/backup/destinations
router.get('/destinations', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, name, provider, config, schedule_cron, interval_minutes, enabled,
              last_run_at, last_run_status, last_run_error, last_run_bytes, next_run_at,
              created_at, updated_at
       FROM vpc_backup_destinations ORDER BY created_at DESC`
    );
    res.json({ destinations: rows.map(supabaseBackup.sanitizeConfig) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/backup/destinations
// body: { name, provider: 'supabase', url, service_role_key, bucket?, interval_minutes?, enabled? }
router.post('/destinations', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, provider, url, service_role_key, bucket, interval_minutes, enabled } = req.body || {};

    if (!name) return res.status(400).json({ error: 'name required' });
    if (provider !== 'supabase') return res.status(400).json({ error: 'unsupported provider' });
    if (!url || !service_role_key) return res.status(400).json({ error: 'url and service_role_key required' });

    // Test first so we don't store bad creds
    try {
      await supabaseBackup.testConnection({ url, service_role_key });
    } catch (testErr) {
      return res.status(400).json({ error: `Connection test failed: ${testErr.message}` });
    }

    const config = {
      url: url.replace(/\/+$/, ''),
      bucket: bucket || 'vpc-backups',
      service_role_key_enc: encrypt(service_role_key),
    };

    const mins = Number.isFinite(+interval_minutes) ? +interval_minutes : 1440; // default daily
    const { rows } = await pool.query(
      `INSERT INTO vpc_backup_destinations
         (name, provider, config, interval_minutes, enabled, created_by, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($4 || ' minutes')::interval)
       RETURNING id, name, provider, config, interval_minutes, enabled, next_run_at, created_at`,
      [name, provider, config, mins, enabled !== false, req.admin.id]
    );

    res.status(201).json(supabaseBackup.sanitizeConfig(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/backup/destinations/:id   { name?, interval_minutes?, enabled?, bucket? }
router.patch('/destinations/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, interval_minutes, enabled, bucket, service_role_key } = req.body || {};

    const { rows } = await pool.query(
      'SELECT * FROM vpc_backup_destinations WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Destination not found' });
    const dest = rows[0];

    const cfg = { ...(dest.config || {}) };
    if (bucket) cfg.bucket = bucket;
    if (service_role_key) cfg.service_role_key_enc = encrypt(service_role_key);

    const { rows: up } = await pool.query(
      `UPDATE vpc_backup_destinations
       SET name = COALESCE($1, name),
           interval_minutes = COALESCE($2, interval_minutes),
           enabled = COALESCE($3, enabled),
           config = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name, interval_minutes, enabled, cfg, req.params.id]
    );

    res.json(supabaseBackup.sanitizeConfig(up[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/backup/destinations/:id
router.delete('/destinations/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM vpc_backup_destinations WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/backup/destinations/:id/test
router.post('/destinations/:id/test', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM vpc_backup_destinations WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Destination not found' });

    const dest = rows[0];
    const { decrypt } = require('../utils/encryption');
    const key = decrypt(dest.config?.service_role_key_enc);
    if (!key) return res.status(400).json({ error: 'No service role key stored' });

    await supabaseBackup.testConnection({ url: dest.config.url, service_role_key: key });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/backup/destinations/:id/run    — manual trigger
router.post('/destinations/:id/run', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await supabaseBackup.runDestination(pool, req.params.id, {
      initiatedBy: req.admin.id,
      reuseBackupId: req.body?.backup_id,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/backup/destinations/:id/runs
router.get('/destinations/:id/runs', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT id, backup_id, status, bytes_uploaded, remote_path, error_message,
              duration_ms, started_at, completed_at
       FROM vpc_backup_destination_runs
       WHERE destination_id = $1
       ORDER BY started_at DESC LIMIT 100`,
      [req.params.id]
    );
    res.json({ runs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
