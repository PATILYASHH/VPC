require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
    console.log('[Migrations] Connected to database');

    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let success = 0;
    let skipped = 0;

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query(sql);
        console.log(`  [OK] ${file}`);
        success++;
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`  [SKIP] ${file} (already applied)`);
          skipped++;
        } else {
          console.error(`  [FAIL] ${file}:`, err.message);
          throw err;
        }
      }
    }

    console.log(`[Migrations] Done: ${success} applied, ${skipped} skipped`);
  } catch (err) {
    console.error('[Migrations] Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
