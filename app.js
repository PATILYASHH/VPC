require('dotenv').config({ path: './backend/.env' });
const app = require('./backend/server');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 8001;

// Serve gallery uploads for preview (before auth, images need direct access)
app.use('/uploads/gallery', express.static(path.join(__dirname, 'uploads', 'gallery')));

// Serve public DB storage files (no auth required)
app.use('/storage/v1', require('./backend/routes/dbStoragePublic'));

// Serve downloadable files (VS Code extension, etc.)
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Serve hosted websites (public, no auth — must be before SPA catch-all)
app.use(require('./backend/routes/webHostingPublic'));

// Serve frontend static files
const frontendDist = path.join(__dirname, 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(frontendDist, 'index.html'));
  }
});

// Auto-apply pending migrations on startup
const pool = app.locals.pool;
pool.query(`ALTER TABLE vpc_admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"all": true}'`)
  .then(() => pool.query(`UPDATE vpc_admins SET permissions = '{"all": true}' WHERE permissions IS NULL`))
  .catch(() => {});

// Initialize web-hosting caches and start server
const webHostingService = require('./backend/services/webHostingService');
const jarvisTelegram = require('./backend/services/jarvisTelegramService');

app.listen(PORT, async () => {
  console.log(`[VPC] Server running on port ${PORT}`);
  console.log(`[VPC] Environment: ${process.env.NODE_ENV || 'development'}`);
  try {
    await webHostingService.refreshSlugCache(pool);
    await webHostingService.refreshDomainCache(pool);
    console.log('[VPC] Web-hosting caches initialized');
  } catch (err) {
    console.error('[VPC] Failed to init web-hosting caches:', err.message);
  }

  // Start Telegram bot polling (if configured)
  try {
    const settingsRouter = require('./backend/routes/settings');
    await jarvisTelegram.init(pool, settingsRouter.decrypt);
    console.log('[VPC] Telegram bot initialized');
  } catch (err) {
    console.error('[VPC] Telegram bot init failed:', err.message);
  }

  // Auto-upgrade check every 5 hours
  const AUTO_UPGRADE_INTERVAL = 5 * 60 * 60 * 1000; // 5 hours
  setInterval(async () => {
    try {
      const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'auto_upgrade'");
      const settings = rows[0]?.value ? JSON.parse(rows[0].value) : { enabled: false };
      if (!settings.enabled) return;

      console.log('[VPC Auto-Upgrade] Checking for updates...');
      const { execSync, exec } = require('child_process');
      const rootDir = __dirname;
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
      const localHash = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();

      try { execSync('git fetch origin --quiet', { cwd: rootDir, timeout: 15000 }); } catch { return; }

      const remoteHash = execSync(`git rev-parse origin/${branch}`, { cwd: rootDir, encoding: 'utf8' }).trim();
      if (localHash === remoteHash) {
        console.log('[VPC Auto-Upgrade] Already up to date.');
        return;
      }

      const behindCount = parseInt(execSync(`git rev-list HEAD..origin/${branch} --count`, { cwd: rootDir, encoding: 'utf8' }).trim()) || 0;
      jarvisTelegram.alertUpgradeAvailable(behindCount).catch(() => {});
      console.log(`[VPC Auto-Upgrade] ${behindCount} new commits. Starting auto-upgrade...`);

      const run = (cmd) => new Promise((resolve, reject) => {
        exec(cmd, { cwd: rootDir, timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`${cmd}: ${stderr || err.message}`));
          else resolve(stdout);
        });
      });

      await run(`git pull origin ${branch}`);
      console.log('[VPC Auto-Upgrade] git pull done');
      await run('cd backend && npm install --production');
      console.log('[VPC Auto-Upgrade] backend deps done');
      await run('cd frontend && npm install');
      console.log('[VPC Auto-Upgrade] frontend deps done');
      await run('cd frontend && npx vite build');
      console.log('[VPC Auto-Upgrade] frontend build done');

      // Run migrations
      try {
        const fs = require('fs');
        const migrationsDir = require('path').join(rootDir, 'backend', 'migrations');
        if (fs.existsSync(migrationsDir)) {
          const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
          for (const file of files) {
            const sql = fs.readFileSync(require('path').join(migrationsDir, file), 'utf8');
            try { await pool.query(sql); } catch {}
          }
        }
      } catch {}

      // Save pending restart flag — user must restart manually
      await pool.query(
        `INSERT INTO vpc_settings (key, value) VALUES ('upgrade_pending_restart', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [JSON.stringify({ upgraded_at: new Date().toISOString(), branch, auto: true, commits: behindCount })]
      ).catch(() => {});

      console.log(`[VPC Auto-Upgrade] Complete! ${behindCount} commits applied. Waiting for manual restart.`);
    } catch (err) {
      console.error('[VPC Auto-Upgrade] Error:', err.message);
    }
  }, AUTO_UPGRADE_INTERVAL);
  console.log('[VPC] Auto-upgrade check scheduled (every 5 hours)');

  // Auto-backup scheduler — checks every hour for due backups
  const BACKUP_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
  setInterval(async () => {
    try {
      const { rows: schedules } = await pool.query(
        "SELECT key, value FROM vpc_settings WHERE key LIKE 'backup_schedule_%'"
      );

      for (const row of schedules) {
        try {
          const schedule = JSON.parse(row.value);
          if (!schedule.enabled) continue;

          const projectId = row.key.replace('backup_schedule_', '');
          const { rows: project } = await pool.query('SELECT db_name, name FROM db_projects WHERE id = $1 AND status = $2', [projectId, 'active']);
          if (!project[0]) continue;

          // Check when last backup was taken
          const { rows: lastBackup } = await pool.query(
            "SELECT created_at FROM backups WHERE database_name = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1",
            [project[0].db_name]
          );

          const lastAt = lastBackup[0]?.created_at ? new Date(lastBackup[0].created_at).getTime() : 0;
          const now = Date.now();
          const intervals = { hourly: 3600000, daily: 86400000, weekly: 604800000, monthly: 2592000000 };
          const intervalMs = intervals[schedule.interval] || intervals.daily;

          if (now - lastAt >= intervalMs) {
            console.log(`[VPC Auto-Backup] Running scheduled ${schedule.interval} backup for ${project[0].name}...`);
            const backupService = require('./backend/services/backupService');
            try {
              await backupService.runBackup(pool, {
                database: project[0].db_name,
                backupType: 'full',
                initiatedBy: null,
                notes: `Auto-backup (${schedule.interval})`,
              });
              jarvisTelegram.alertBackupComplete(project[0].db_name).catch(() => {});
            } catch (backupErr) {
              jarvisTelegram.alertBackupFailed(project[0].db_name, backupErr.message).catch(() => {});
              throw backupErr;
            }

            // Cleanup old backups beyond keepCount
            const keepCount = schedule.keepCount || 7;
            const { rows: oldBackups } = await pool.query(
              `SELECT id, file_path FROM backups WHERE database_name = $1 AND status = 'completed' ORDER BY created_at DESC OFFSET $2`,
              [project[0].db_name, keepCount]
            );
            for (const old of oldBackups) {
              try {
                const fs = require('fs');
                if (fs.existsSync(old.file_path)) fs.unlinkSync(old.file_path);
                await pool.query('DELETE FROM backups WHERE id = $1', [old.id]);
              } catch {}
            }
            if (oldBackups.length > 0) {
              console.log(`[VPC Auto-Backup] Cleaned ${oldBackups.length} old backup(s) for ${project[0].name}`);
            }
          }
        } catch (schedErr) {
          console.error('[VPC Auto-Backup] Schedule error:', schedErr.message);
        }
      }
    } catch (err) {
      console.error('[VPC Auto-Backup] Error:', err.message);
    }
  }, BACKUP_CHECK_INTERVAL);
  console.log('[VPC] Auto-backup scheduler running (checks every hour)');
});
