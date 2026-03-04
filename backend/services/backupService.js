const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

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
          resolve({ ...backup, status: 'failed', error_message: err.message });
        } else {
          const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : { size: 0 };
          await pool.query(
            `UPDATE backups SET status = 'completed', file_size_bytes = $1, completed_at = NOW() WHERE id = $2`,
            [stats.size, backup.id]
          );
          resolve({ ...backup, status: 'completed', file_size_bytes: stats.size });
        }
      } catch (updateErr) {
        console.error('[Backup] Failed to update record:', updateErr.message);
        resolve({ ...backup, status: 'failed', error_message: updateErr.message });
      }
    });
  });
}

async function restore(pool, backupId) {
  const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [backupId]);
  if (rows.length === 0) throw new Error('Backup not found');

  const backup = rows[0];
  if (!fs.existsSync(backup.file_path)) throw new Error('Backup file not found on disk');

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

module.exports = { runBackup, restore, BACKUP_DIR };
