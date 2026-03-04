const express = require('express');
const path = require('path');
const fs = require('fs');
const backupService = require('../services/backupService');

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

module.exports = router;
