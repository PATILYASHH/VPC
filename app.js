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
});
