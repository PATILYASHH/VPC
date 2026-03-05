require('dotenv').config({ path: './backend/.env' });
const app = require('./backend/server');
const path = require('path');
const express = require('express');
const fs = require('fs');
const { Client } = require('pg');

const PORT = process.env.PORT || 8001;

// Serve frontend build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
    }
  });
}

// Auto-run pending migrations on startup (non-blocking — server starts even if migrations fail)
async function runMigrations() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'vpc',
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const migrationsDir = path.join(__dirname, 'backend', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      } catch {
        // Silently skip — migrations use IF NOT EXISTS / IF EXISTS
      }
    }
    console.log('[Migrations] Done');
  } catch (err) {
    console.error('[Migrations] Skipped:', err.message);
  } finally {
    try { await client.end(); } catch {}
  }
}

// Start server immediately, run migrations in parallel
app.listen(PORT, () => {
  console.log(`[VPC] Server running on port ${PORT}`);
  console.log(`[VPC] Environment: ${process.env.NODE_ENV || 'development'}`);
});
runMigrations();
