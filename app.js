require('dotenv').config({ path: './backend/.env' });
const app = require('./backend/server');
const path = require('path');
const express = require('express');

const PORT = process.env.PORT || 8001;

// Serve gallery uploads for preview (before auth, images need direct access)
app.use('/uploads/gallery', express.static(path.join(__dirname, 'uploads', 'gallery')));

// Serve public BanaDB storage files (no auth required)
app.use('/storage/v1', require('./backend/routes/banaStoragePublic'));

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

  // Start Jarvis Telegram bot polling (if configured)
  try {
    const jarvisTelegram = require('./backend/services/jarvisTelegramService');
    const settingsRouter = require('./backend/routes/settings');
    await jarvisTelegram.init(pool, settingsRouter.decrypt);
    console.log('[VPC] Jarvis Telegram bot initialized');
  } catch (err) {
    console.error('[VPC] Jarvis Telegram init failed:', err.message);
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
});
