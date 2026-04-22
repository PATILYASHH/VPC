const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const bus = require('./realtimeBus');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function runBackup(pool, { database, backupType = 'full', initiatedBy, notes }) {
  ensureBackupDir();

  const dbName = database || process.env.DB_NAME || 'vpc';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${dbName}_${backupType}_${timestamp}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  // Create backup record
  const { rows } = await pool.query(
    `INSERT INTO backups (filename, file_path, database_name, backup_type, status, initiated_by, notes)
     VALUES ($1, $2, $3, $4, 'running', $5, $6) RETURNING *`,
    [filename, filePath, dbName, backupType, initiatedBy, notes]
  );
  const backup = rows[0];

  // Run pg_dump in background
  const args = [
    '-h', process.env.DB_HOST || 'localhost',
    '-p', process.env.DB_PORT || '5432',
    '-U', process.env.DB_USER || 'vpc_admin',
    '-d', dbName,
    '-F', 'c', // custom format (compressed)
    '-f', filePath,
  ];

  if (backupType === 'schema_only') args.push('--schema-only');
  if (backupType === 'data_only') args.push('--data-only');

  bus.publish('backup:progress', { backup_id: backup.id, database: dbName, status: 'running' });

  return new Promise((resolve) => {
    const env = { ...process.env };
    if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;

    execFile('pg_dump', args, { timeout: 300000, env }, async (err, stdout, stderr) => {
      try {
        if (err) {
          await pool.query(
            `UPDATE backups SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
            [err.message, backup.id]
          );
          bus.publish('backup:progress', { backup_id: backup.id, database: dbName, status: 'failed', error: err.message });
          resolve({ ...backup, status: 'failed', error_message: err.message });
        } else {
          const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
          await pool.query(
            `UPDATE backups SET status = 'completed', file_size_bytes = $1, completed_at = NOW() WHERE id = $2`,
            [stats.size, backup.id]
          );
          bus.publish('backup:progress', { backup_id: backup.id, database: dbName, status: 'completed', bytes: stats.size });
          resolve({ ...backup, status: 'completed', file_size_bytes: stats.size });
        }
      } catch (updateErr) {
        console.error('[Backup] Failed to update record:', updateErr.message);
        resolve({ ...backup, status: 'failed', error_message: updateErr.message });
      }
    });
  });
}

async function fetchFromSupabase(pool, backupId) {
  const { decrypt } = require('../utils/encryption');
  const https = require('https');
  const http = require('http');

  const { rows } = await pool.query(
    `SELECT dr.remote_path, d.config
     FROM vpc_backup_destination_runs dr
     JOIN vpc_backup_destinations d ON d.id = dr.destination_id
     WHERE dr.backup_id = $1 AND dr.status = 'success' AND d.provider = 'supabase'
     ORDER BY dr.completed_at DESC LIMIT 1`,
    [backupId]
  );
  if (rows.length === 0) throw new Error('No Supabase upload found for this backup');

  const { remote_path, config } = rows[0];
  const key = decrypt(config.service_role_key_enc);
  if (!key) throw new Error('Could not decrypt service role key');

  const url = `${config.url.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(config.bucket)}/${remote_path}`;
  const tempPath = path.join(BACKUP_DIR, `restore-${Date.now()}.sql.gz`);
  ensureBackupDir();

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(u, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }, (res) => {
      if (res.statusCode >= 400) {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => reject(new Error(`Supabase download failed (HTTP ${res.statusCode}): ${body.slice(0, 200)}`)));
        return;
      }
      const out = fs.createWriteStream(tempPath);
      res.pipe(out);
      out.on('finish', () => { out.close(); resolve(tempPath); });
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(600000);
    req.end();
  });
}

async function restore(pool, backupId) {
  const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [backupId]);
  if (rows.length === 0) throw new Error('Backup not found');

  const backup = rows[0];
  // If local file missing, try to pull from a Supabase destination
  if (!fs.existsSync(backup.file_path)) {
    try {
      const restored = await fetchFromSupabase(pool, backupId);
      backup.file_path = restored;
      console.log(`[backup] restored file from Supabase → ${restored}`);
    } catch (err) {
      throw new Error(`Backup file missing locally and no cloud copy available: ${err.message}`);
    }
  }

  const args = [
    '-h', process.env.DB_HOST || 'localhost',
    '-p', process.env.DB_PORT || '5432',
    '-U', process.env.DB_USER || 'vpc_admin',
    '-d', backup.database_name,
    '--clean',
    backup.file_path,
  ];

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;

    execFile('pg_restore', args, { timeout: 300000, env }, async (err) => {
      if (err) return reject(new Error(`Restore failed: ${err.message}`));

      await pool.query(
        `UPDATE backups SET status = 'restored' WHERE id = $1`,
        [backupId]
      );
      resolve({ message: 'Backup restored successfully' });
    });
  });
}

module.exports = { runBackup, restore, fetchFromSupabase, BACKUP_DIR };
