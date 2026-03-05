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

// Auto-run pending migrations on startup
async function runMigrations() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'vpc',
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
  });
  try {
    await client.connect();
    const migrationsDir = path.join(__dirname, 'backend', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
        applied++;
      } catch (err) {
        if (!err.message.includes('already exists')) {
          console.error(`[Migrations] FAIL ${file}:`, err.message);
        }
      }
    }
    if (applied) console.log(`[Migrations] ${applied} migration(s) applied`);
  } catch (err) {
    console.error('[Migrations] Error:', err.message);
  } finally {
    await client.end();
  }
}

runMigrations().then(() => {
  app.listen(PORT, () => {
    console.log(`[VPC] Server running on port ${PORT}`);
    console.log(`[VPC] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
});
