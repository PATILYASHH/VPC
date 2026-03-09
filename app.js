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

// Serve frontend build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
    }
  });
}

// Auto-apply pending migrations on startup
const pool = app.locals.pool;
pool.query(`ALTER TABLE vpc_admins ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{"all": true}'`)
  .then(() => pool.query(`UPDATE vpc_admins SET permissions = '{"all": true}' WHERE permissions IS NULL`))
  .catch(() => {});

// Refresh web hosting slug cache on startup
const webHostingService = require('./backend/services/webHostingService');
webHostingService.refreshSlugCache(pool);
webHostingService.refreshDomainCache(pool);

app.listen(PORT, () => {
  console.log(`[VPC] Server running on port ${PORT}`);
  console.log(`[VPC] Environment: ${process.env.NODE_ENV || 'development'}`);
});
