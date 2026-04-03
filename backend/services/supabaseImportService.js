const { Pool } = require('pg');
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const dbService = require('./dbService');

// ── Encryption helpers (for storing connection strings) ────────────
const ALGO = 'aes-256-gcm';
const ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'db-default-key', 'db-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(data) {
  const [ivHex, tagHex, encrypted] = data.split(':');
  const decipher = crypto.createDecipheriv(ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Connection helpers ─────────────────────────────────────────────

function parseConnectionString(connStr) {
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
    throw new Error('Invalid connection string format');
  }
}

function createRemotePool(connectionString) {
  const conn = parseConnectionString(connectionString);
  return new Pool({
    host: conn.host,
    port: parseInt(conn.port),
    user: conn.user,
    password: conn.password,
    database: conn.database,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    statement_timeout: 300000,
  });
}

// ── In-memory job tracker ──────────────────────────────────────────

const importJobs = new Map();

// Auto-cleanup jobs older than 1 hour
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of importJobs) {
    if (job.updatedAt < cutoff && job.status !== 'running') {
      importJobs.delete(id);
    }
  }
}, 600000);

function createJob() {
  const jobId = uuidv4();
  const job = {
    id: jobId,
    status: 'running',
    progress: 0,
    steps: [],
    message: 'Starting import...',
    tables_imported: 0,
    rows_imported: 0,
    auth_users_imported: 0,
    duration_ms: 0,
    updatedAt: Date.now(),
  };
  importJobs.set(jobId, job);
  return job;
}

function updateJob(jobId, updates) {
  const job = importJobs.get(jobId);
  if (job) {
    Object.assign(job, updates, { updatedAt: Date.now() });
  }
}

function addJobStep(jobId, step, status, message) {
  const job = importJobs.get(jobId);
  if (job) {
    // Update existing step or add new one
    const existing = job.steps.find((s) => s.step === step);
    if (existing) {
      existing.status = status;
      existing.message = message;
    } else {
      job.steps.push({ step, status, message });
    }
    job.updatedAt = Date.now();
  }
}

function getJobStatus(jobId) {
  return importJobs.get(jobId) || null;
}

// ── Test Connection ────────────────────────────────────────────────

async function testConnection(connectionString) {
  const remote = createRemotePool(connectionString);
  try {
    await remote.query('SELECT 1');

    const sizeResult = await remote.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
    );
    const tableResult = await remote.query(
      `SELECT count(*) AS cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );

    let authUserCount = 0;
    try {
      const authResult = await remote.query('SELECT count(*) AS cnt FROM auth.users');
      authUserCount = parseInt(authResult.rows[0].cnt);
    } catch {}

    const schemasResult = await remote.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
       ORDER BY schema_name`
    );

    const tablesResult = await remote.query(
      `SELECT c.relname AS name,
              pg_stat_get_live_tuples(c.oid) AS row_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`
    );

    return {
      connected: true,
      database_size: sizeResult.rows[0].size,
      table_count: parseInt(tableResult.rows[0].cnt),
      auth_user_count: authUserCount,
      schemas: schemasResult.rows.map((r) => r.schema_name),
      tables: tablesResult.rows.map((r) => ({ name: r.name, rows: parseInt(r.row_count) })),
    };
  } finally {
    await remote.end();
  }
}

// ── Save / Get / Remove connection ─────────────────────────────────

async function saveConnection(mainPool, projectId, connectionString) {
  const encrypted = encrypt(connectionString);
  await mainPool.query(
    `UPDATE db_projects SET supabase_connection = $1, updated_at = NOW() WHERE id = $2`,
    [encrypted, projectId]
  );
}

async function getConnection(mainPool, projectId) {
  const { rows } = await mainPool.query(
    `SELECT supabase_connection FROM db_projects WHERE id = $1`,
    [projectId]
  );
  if (!rows[0]?.supabase_connection) return null;
  return decrypt(rows[0].supabase_connection);
}

async function removeConnection(mainPool, projectId) {
  await mainPool.query(
    `UPDATE db_projects SET supabase_connection = NULL, last_sync_at = NULL, sync_status = NULL, updated_at = NOW() WHERE id = $1`,
    [projectId]
  );
}

// ── pg_dump helper ─────────────────────────────────────────────────

function runPgDump(conn, dumpPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', conn.host,
      '-p', conn.port,
      '-U', conn.user,
      '-d', conn.database,
      '-F', 'c',
      '-f', dumpPath,
      '--no-owner',
      '--no-acl',
      '--no-comments',
      // Exclude all Supabase system schemas
      '-N', 'auth',
      '-N', 'storage',
      '-N', 'realtime',
      '-N', '_realtime',
      '-N', 'supabase_functions',
      '-N', 'supabase_migrations',
      '-N', 'extensions',
      '-N', 'graphql',
      '-N', 'graphql_public',
      '-N', 'pgbouncer',
      '-N', 'pgsodium',
      '-N', 'vault',
      '-N', '_analytics',
      '-N', 'net',
      '-N', 'supabase_internal',
    ];

    const env = { ...process.env, PGPASSWORD: conn.password, PGSSLMODE: 'require' };

    execFile('pg_dump', args, { timeout: 600000, env }, (err, stdout, stderr) => {
      if (err) {
        // pg_dump may write warnings to stderr even on success
        // Only reject if the exit code is non-zero
        const msg = stderr || err.message;
        reject(new Error(`pg_dump failed: ${msg}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ── Pre-restore cleanup: drop all public tables to prevent duplicates ──

async function cleanPublicSchema(project) {
  const { Pool: LocalPool } = require('pg');
  // Use admin credentials so we can drop tables regardless of ownership
  const adminPool = new LocalPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
    max: 2,
    idleTimeoutMillis: 10000,
  });

  try {
    // Drop and recreate the public schema to guarantee a clean slate.
    // This avoids ownership and FK-dependency issues that cause --clean
    // to silently fail and duplicate data (double entries on sync).
    await adminPool.query('DROP SCHEMA public CASCADE');
    await adminPool.query('CREATE SCHEMA public');

    // Re-grant permissions to the project user
    const safeUser = project.db_user.replace(/"/g, '""');
    await adminPool.query(`GRANT ALL ON SCHEMA public TO "${safeUser}"`);
    await adminPool.query('GRANT ALL ON SCHEMA public TO PUBLIC');
  } finally {
    await adminPool.end();
  }
}

// ── pg_restore helper ──────────────────────────────────────────────

function runPgRestore(project, dumpPath) {
  return new Promise((resolve, reject) => {
    // Use admin credentials for pg_restore so it can create objects properly.
    // Ownership is reassigned to the project user after restore.
    const args = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER || 'vpc_admin',
      '-d', project.db_name,
      '--no-owner',
      '--no-acl',
      dumpPath,
    ];

    const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };

    execFile('pg_restore', args, { timeout: 600000, env }, (err, stdout, stderr) => {
      // pg_restore returns exit code 1 for warnings (e.g., "relation does not exist")
      // This is normal and expected — only real failures have exit code 2+
      if (err && err.code !== null && err.code > 1) {
        reject(new Error(`pg_restore failed: ${stderr || err.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ── Post-restore: reassign ownership to project user ──────────────

async function reassignOwnership(project) {
  const { Pool: LocalPool } = require('pg');
  const adminPool = new LocalPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
    max: 2,
    idleTimeoutMillis: 10000,
  });

  try {
    const safeUser = project.db_user.replace(/'/g, "''");
    await adminPool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        -- Reassign tables
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO ${safeUser}', r.tablename);
        END LOOP;
        -- Reassign sequences
        FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'
        LOOP
          EXECUTE format('ALTER SEQUENCE public.%I OWNER TO ${safeUser}', r.sequencename);
        END LOOP;
        -- Reassign functions
        FOR r IN SELECT p.oid::regprocedure AS func_signature
                 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname = 'public'
                 AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        LOOP
          EXECUTE format('ALTER FUNCTION %s OWNER TO ${safeUser}', r.func_signature);
        END LOOP;
      END $$;
    `);
  } finally {
    await adminPool.end();
  }
}

// ── Prepare local DB: install extensions that exist on remote ───────

async function prepareLocalExtensions(remote, local, jobId) {
  // Query remote for installed extensions and their schemas
  const extResult = await remote.query(`
    SELECT e.extname, n.nspname AS schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname NOT IN ('plpgsql')
  `);

  if (extResult.rows.length === 0) return 0;

  // Create the extensions schema if any extension uses it
  const schemas = [...new Set(extResult.rows.map((r) => r.schema).filter((s) => s !== 'public'))];
  for (const schema of schemas) {
    try {
      await local.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } catch (e) {
      console.error(`[Import] Create schema ${schema}:`, e.message);
    }
  }

  // Install each extension in the same schema as remote
  let installed = 0;
  for (const ext of extResult.rows) {
    try {
      await local.query(`CREATE EXTENSION IF NOT EXISTS "${ext.extname}" SCHEMA "${ext.schema}"`);
      installed++;
    } catch (e) {
      // Some extensions may not be available on the local server — try without schema
      try {
        await local.query(`CREATE EXTENSION IF NOT EXISTS "${ext.extname}"`);
        installed++;
      } catch (e2) {
        console.error(`[Import] Extension ${ext.extname}:`, e2.message);
      }
    }
  }

  addJobStep(jobId, 'extensions', 'done', `Installed ${installed}/${extResult.rows.length} extensions (${extResult.rows.map((e) => e.extname).join(', ')})`);
  return installed;
}

// ── Start Import (background job) ──────────────────────────────────

function startImport(mainPool, project, { connectionString, importAuth = true }) {
  const job = createJob();
  const conn = parseConnectionString(connectionString);
  const dumpPath = path.join(
    process.env.TEMP || '/tmp',
    `db_import_${project.id}.dump`
  );

  // Run import in background (not awaited)
  (async () => {
    const startTime = Date.now();
    let remote = null;

    try {
      // ── Step 1: pg_dump remote Supabase DB ─────────────────
      remote = createRemotePool(connectionString);
      const local = dbService.getProjectPool(project);

      addJobStep(job.id, 'dump', 'running', 'Dumping remote Supabase database...');
      updateJob(job.id, { progress: 5, message: 'Dumping remote database...' });

      await runPgDump(conn, dumpPath);

      // Get dump file size
      const dumpStats = fs.statSync(dumpPath);
      const dumpSizeMb = (dumpStats.size / 1048576).toFixed(1);
      addJobStep(job.id, 'dump', 'done', `Database dumped (${dumpSizeMb} MB compressed)`);
      updateJob(job.id, { progress: 30 });

      // ── Step 2: Clean public schema to prevent duplicate entries ──
      addJobStep(job.id, 'restore', 'running', 'Cleaning existing data...');
      updateJob(job.id, { progress: 32, message: 'Cleaning existing data...' });

      // Drop and recreate public schema to guarantee a clean slate.
      // Without this, pg_restore --clean can silently fail to DROP tables
      // (due to ownership mismatches or FK dependencies), causing data to
      // be appended instead of replaced on subsequent syncs.
      await cleanPublicSchema(project);

      // ── Step 3: Re-install extensions after schema cleanup ──
      addJobStep(job.id, 'extensions', 'running', 'Installing required extensions...');
      updateJob(job.id, { progress: 35, message: 'Preparing database extensions...' });
      await prepareLocalExtensions(remote, local, job.id);

      // ── Step 4: pg_restore into DB project DB ──────────
      addJobStep(job.id, 'restore', 'running', 'Restoring into DB project...');
      updateJob(job.id, { progress: 45, message: 'Restoring to DB...' });

      const restoreResult = await runPgRestore(project, dumpPath);

      // Log any warnings from pg_restore for debugging
      if (restoreResult.stderr) {
        const warnings = restoreResult.stderr.split('\n').filter((l) => l.trim());
        const errorLines = warnings.filter((l) => l.includes('ERROR'));
        if (errorLines.length > 0) {
          console.error(`[Import] pg_restore had ${errorLines.length} errors:\n${errorLines.slice(0, 10).join('\n')}`);
          addJobStep(job.id, 'restore', 'done', `Database restored with ${errorLines.length} warnings`);
        } else {
          addJobStep(job.id, 'restore', 'done', 'Database restored successfully');
        }
      } else {
        addJobStep(job.id, 'restore', 'done', 'Database restored successfully');
      }
      updateJob(job.id, { progress: 72 });

      // ── Step 4b: Reassign ownership to project user ────────
      try {
        await reassignOwnership(project);
      } catch (ownerErr) {
        console.error('[Import] Ownership reassignment warning:', ownerErr.message);
      }
      updateJob(job.id, { progress: 75 });

      // ── Step 5: Count imported tables ──────────────────────
      addJobStep(job.id, 'verify', 'running', 'Verifying imported data...');
      updateJob(job.id, { message: 'Verifying import...' });

      const tableCountResult = await local.query(
        `SELECT count(*) AS cnt FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      const tablesImported = parseInt(tableCountResult.rows[0].cnt);

      // Count total rows across all tables (use ANALYZE first for accurate counts)
      try { await local.query('ANALYZE'); } catch {}
      let totalRows = 0;
      try {
        const rowsResult = await local.query(`
          SELECT sum(n_live_tup) AS total
          FROM pg_stat_user_tables
          WHERE schemaname = 'public'
        `);
        totalRows = parseInt(rowsResult.rows[0].total) || 0;
      } catch {}

      addJobStep(job.id, 'verify', 'done', `Verified: ${tablesImported} tables, ${totalRows.toLocaleString()} rows`);
      updateJob(job.id, { progress: 80, tables_imported: tablesImported, rows_imported: totalRows });

      // ── Step 6: Import auth users (optional) ───────────────
      let authUsersImported = 0;
      if (importAuth) {
        addJobStep(job.id, 'auth', 'running', 'Migrating auth users...');
        updateJob(job.id, { progress: 85, message: 'Migrating auth users...' });

        try {
          const authResult = await importAuthUsers(remote, local);
          authUsersImported = authResult.imported;
          addJobStep(job.id, 'auth', 'done', `Imported ${authResult.imported}/${authResult.total} auth users`);
        } catch (e) {
          addJobStep(job.id, 'auth', 'warning', `Auth import skipped: ${e.message}`);
        }
      }

      // ── Step 7: Save connection for future sync ────────────
      addJobStep(job.id, 'link', 'running', 'Saving connection for sync...');
      updateJob(job.id, { progress: 95, message: 'Finalizing...' });

      await saveConnection(mainPool, project.id, connectionString);
      await mainPool.query(
        `UPDATE db_projects SET last_sync_at = NOW(), sync_status = 'synced', updated_at = NOW() WHERE id = $1`,
        [project.id]
      );

      addJobStep(job.id, 'link', 'done', 'Connection saved for future sync');

      // ── Done ───────────────────────────────────────────────
      updateJob(job.id, {
        status: 'completed',
        progress: 100,
        message: `Import complete! ${tablesImported} tables, ${totalRows.toLocaleString()} rows, ${authUsersImported} auth users`,
        tables_imported: tablesImported,
        rows_imported: totalRows,
        auth_users_imported: authUsersImported,
        duration_ms: Date.now() - startTime,
      });

    } catch (err) {
      console.error('[Import] Fatal error:', err.message);
      addJobStep(job.id, 'error', 'failed', err.message);
      updateJob(job.id, {
        status: 'failed',
        message: `Import failed: ${err.message}`,
        duration_ms: Date.now() - startTime,
      });

      // Mark project sync as error
      try {
        await mainPool.query(
          `UPDATE db_projects SET sync_status = 'error', updated_at = NOW() WHERE id = $1`,
          [project.id]
        );
      } catch {}
    } finally {
      // Cleanup: delete temp dump file
      try {
        if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath);
      } catch {}

      // Close remote pool if opened
      if (remote) {
        try { await remote.end(); } catch {}
      }
    }
  })();

  return job.id;
}

// ── Start Sync (background job) ────────────────────────────────────

async function startSync(mainPool, project) {
  const connectionString = await getConnection(mainPool, project.id);
  if (!connectionString) throw new Error('No Supabase connection linked. Import first.');

  // Mark as syncing
  await mainPool.query(
    `UPDATE db_projects SET sync_status = 'syncing', updated_at = NOW() WHERE id = $1`,
    [project.id]
  );

  // Reuse the same import flow — pg_dump/pg_restore with --clean replaces everything
  return startImport(mainPool, project, { connectionString, importAuth: true });
}

// ── Helper: Import auth users ──────────────────────────────────────

async function importAuthUsers(remote, local) {
  let authUsers;
  try {
    const result = await remote.query(
      `SELECT id, email, encrypted_password, raw_user_meta_data,
              email_confirmed_at, banned_until, created_at, updated_at
       FROM auth.users ORDER BY created_at`
    );
    authUsers = result.rows;
  } catch {
    throw new Error('Cannot access auth.users (may need direct DB connection, not pooler)');
  }

  if (authUsers.length === 0) return { imported: 0, total: 0 };

  // Ensure auth_users table exists
  await local.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      metadata JSONB DEFAULT '{}',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

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

      await local.query(
        `INSERT INTO auth_users (id, email, password_hash, is_active, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           is_active = EXCLUDED.is_active,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at`,
        [user.id, user.email, user.encrypted_password, isActive,
         JSON.stringify(metadata), user.created_at, user.updated_at || new Date()]
      );
      imported++;
    } catch (e) {
      console.error(`[Import] Auth user ${user.email}:`, e.message);
    }
  }

  return { imported, total: authUsers.length };
}

module.exports = {
  testConnection,
  startImport,
  startSync,
  getJobStatus,
  saveConnection,
  getConnection,
  removeConnection,
  parseConnectionString,
};
