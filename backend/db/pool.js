const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'vpc',
  user: process.env.DB_USER || 'vpc_admin',
  password: process.env.DB_PASSWORD,
  max: 50,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[Pool] Unexpected error on idle client:', err.message);
});

module.exports = pool;
