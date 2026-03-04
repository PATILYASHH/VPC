require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
  const username = process.env.VPC_ADMIN_USERNAME;
  const email = process.env.VPC_ADMIN_EMAIL;
  const password = process.env.VPC_ADMIN_PASSWORD;

  if (!username || !email || !password) {
    console.error('[Seed] Missing VPC_ADMIN_USERNAME, VPC_ADMIN_EMAIL, or VPC_ADMIN_PASSWORD in .env');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'vpc',
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await client.query(
      `INSERT INTO vpc_admins (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username`,
      [username, email, passwordHash, username]
    );

    if (result.rows.length > 0) {
      console.log(`[Seed] Admin created: ${result.rows[0].username} (${result.rows[0].id})`);
    } else {
      console.log(`[Seed] Admin "${username}" already exists, skipping`);
    }
  } catch (err) {
    console.error('[Seed] Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedAdmin();
