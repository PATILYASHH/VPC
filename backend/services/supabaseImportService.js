const { execFile } = require('child_process');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const banadbService = require('./banadbService');

const IMPORT_DIR = path.join(__dirname, '..', '..', 'tmp_imports');

function ensureImportDir() {
  if (!fs.existsSync(IMPORT_DIR)) {
    fs.mkdirSync(IMPORT_DIR, { recursive: true });
  }
}

function parseConnectionString(connStr) {
  // postgresql://user:password@host:port/database
  // Also handles: postgres://user.project:password@host:port/database
  try {
    const url = new URL(connStr);
    return {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) || 'postgres',
    };
  } catch {
    throw new Error('Invalid connection string. Expected format: postgresql://user:password@host:port/database');
  }
}

async function testConnection(connectionString) {
  const conn = parseConnectionString(connectionString);
  const tempPool = new Pool({
    host: conn.host,
    port: parseInt(conn.port),
    user: conn.user,
    password: conn.password,
    database: conn.database,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
  });

  try {
    // Test basic connectivity
    await tempPool.query('SELECT 1');

    // Get database size
    const sizeResult = await tempPool.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
              pg_database_size(current_database()) AS size_bytes`
    );

    // Count tables in public schema
    const tableResult = await tempPool.query(
      `SELECT count(*) AS cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );

    // Count auth users (Supabase stores them in auth.users)
    let authUserCount = 0;
    try {
      const authResult = await tempPool.query('SELECT count(*) AS cnt FROM auth.users');
      authUserCount = parseInt(authResult.rows[0].cnt);
    } catch {
      // auth schema may not exist or be accessible
    }

    // List all schemas
    const schemasResult = await tempPool.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       ORDER BY schema_name`
    );

    return {
      connected: true,
      database_size: sizeResult.rows[0].size,
      database_size_bytes: parseInt(sizeResult.rows[0].size_bytes),
      table_count: parseInt(tableResult.rows[0].cnt),
      auth_user_count: authUserCount,
      schemas: schemasResult.rows.map((r) => r.schema_name),
    };
  } finally {
    await tempPool.end();
  }
}

function runPgDump(conn, dumpPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', conn.host,
      '-p', conn.port,
      '-U', conn.user,
      '-d', conn.database,
      '-F', 'c',                // custom compressed format
      '-f', dumpPath,
      '--no-owner',             // don't set ownership
      '--no-acl',               // don't dump access privileges
      '--no-comments',          // skip comments
      '-N', 'auth',             // exclude Supabase auth schema
      '-N', 'storage',          // exclude Supabase storage schema
      '-N', 'realtime',         // exclude Supabase realtime schema
      '-N', '_realtime',
      '-N', 'supabase_functions',
      '-N', 'supabase_migrations',
      '-N', 'extensions',
      '-N', 'graphql',
      '-N', 'graphql_public',
      '-N', 'net',
      '-N', 'pgsodium',
      '-N', 'pgsodium_masks',
      '-N', 'vault',
      '-N', '_analytics',
    ];

    const env = { ...process.env, PGPASSWORD: conn.password };

    execFile('pg_dump', args, { timeout: 600000, env }, (err, stdout, stderr) => {
      if (err) {
        // pg_dump may return warnings in stderr but still succeed
        if (!fs.existsSync(dumpPath) || fs.statSync(dumpPath).size === 0) {
          return reject(new Error(`pg_dump failed: ${err.message}. ${stderr || ''}`));
        }
      }
      resolve({ dumpPath, size: fs.statSync(dumpPath).size });
    });
  });
}

function runPgRestore(project, dumpPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', project.db_user,
      '-d', project.db_name,
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      dumpPath,
    ];

    const env = { ...process.env, PGPASSWORD: project.db_password };

    execFile('pg_restore', args, { timeout: 600000, env }, (err, stdout, stderr) => {
      // pg_restore often returns non-zero exit code for warnings (like "does not exist" on --clean)
      // This is normal and expected, so we don't treat it as a hard failure
      if (err && stderr && stderr.includes('FATAL')) {
        return reject(new Error(`pg_restore failed: ${stderr}`));
      }
      resolve({ restored: true, warnings: stderr || '' });
    });
  });
}

async function importAuthUsers(connectionString, projectPool) {
  const conn = parseConnectionString(connectionString);
  const remotePool = new Pool({
    host: conn.host,
    port: parseInt(conn.port),
    user: conn.user,
    password: conn.password,
    database: conn.database,
    max: 2,
    connectionTimeoutMillis: 10000,
  });

  try {
    // Fetch Supabase auth users
    const { rows: authUsers } = await remotePool.query(
      `SELECT id, email, encrypted_password, raw_user_meta_data,
              email_confirmed_at, banned_until, created_at, updated_at
       FROM auth.users
       ORDER BY created_at`
    );

    if (authUsers.length === 0) return { imported: 0 };

    let imported = 0;
    for (const user of authUsers) {
      try {
        const isActive = !user.banned_until || new Date(user.banned_until) < new Date();
        const metadata = {
          imported_from: 'supabase',
          confirmed: !!user.email_confirmed_at,
          original_id: user.id,
          ...(user.raw_user_meta_data || {}),
        };

        await projectPool.query(
          `INSERT INTO auth_users (id, email, password_hash, is_active, metadata, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (email) DO UPDATE SET
             password_hash = EXCLUDED.password_hash,
             is_active = EXCLUDED.is_active,
             metadata = EXCLUDED.metadata,
             updated_at = EXCLUDED.updated_at`,
          [
            user.id,
            user.email,
            user.encrypted_password, // bcrypt hash, compatible with BanaDB
            isActive,
            JSON.stringify(metadata),
            user.created_at,
            user.updated_at || new Date(),
          ]
        );
        imported++;
      } catch (err) {
        console.error(`[Import] Failed to import auth user ${user.email}:`, err.message);
      }
    }

    return { imported, total: authUsers.length };
  } finally {
    await remotePool.end();
  }
}

async function importFromSupabase(mainPool, project, { connectionString, importAuth = true }) {
  ensureImportDir();
  const startTime = Date.now();
  const conn = parseConnectionString(connectionString);
  const importId = crypto.randomBytes(8).toString('hex');
  const dumpPath = path.join(IMPORT_DIR, `bana_import_${importId}.dump`);

  const result = {
    status: 'running',
    steps: [],
    tables_imported: 0,
    auth_users_imported: 0,
    duration_ms: 0,
  };

  try {
    // Step 1: pg_dump the remote Supabase database
    result.steps.push({ step: 'dump', status: 'running', message: 'Dumping remote Supabase database...' });
    const dumpResult = await runPgDump(conn, dumpPath);
    result.steps[result.steps.length - 1] = {
      step: 'dump', status: 'done',
      message: `Database dumped (${Math.round(dumpResult.size / 1024)} KB)`,
    };

    // Step 2: pg_restore into the BanaDB project database
    result.steps.push({ step: 'restore', status: 'running', message: 'Restoring into BanaDB project...' });
    await runPgRestore(project, dumpPath);
    result.steps[result.steps.length - 1] = {
      step: 'restore', status: 'done', message: 'Database restored successfully',
    };

    // Count imported tables
    const projectPool = banadbService.getProjectPool(project);
    const tableResult = await projectPool.query(
      `SELECT count(*) AS cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    result.tables_imported = parseInt(tableResult.rows[0].cnt);

    // Step 3: Import auth users (optional)
    if (importAuth) {
      result.steps.push({ step: 'auth', status: 'running', message: 'Migrating auth users...' });
      try {
        const authResult = await importAuthUsers(connectionString, projectPool);
        result.auth_users_imported = authResult.imported || 0;
        result.steps[result.steps.length - 1] = {
          step: 'auth', status: 'done',
          message: `Imported ${authResult.imported}/${authResult.total} auth users`,
        };
      } catch (authErr) {
        result.steps[result.steps.length - 1] = {
          step: 'auth', status: 'warning',
          message: `Auth import skipped: ${authErr.message}`,
        };
      }
    }

    result.status = 'completed';
    result.message = `Import complete! ${result.tables_imported} tables, ${result.auth_users_imported} auth users`;
  } catch (err) {
    result.status = 'failed';
    result.message = err.message;
    result.steps.push({ step: 'error', status: 'failed', message: err.message });
  } finally {
    // Cleanup dump file
    try { if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath); } catch {}
    result.duration_ms = Date.now() - startTime;
  }

  return result;
}

module.exports = {
  testConnection,
  importFromSupabase,
  parseConnectionString,
};
