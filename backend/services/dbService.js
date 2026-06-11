const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const dbStorage = require('./dbStorageService');

// In-memory pool cache for project databases
const projectPools = new Map();
const projectAdminPools = new Map();

function getProjectPool(project) {
  if (projectPools.has(project.id)) {
    return projectPools.get(project.id);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: project.db_user,
    password: project.db_password,
    max: Math.min(project.max_connections || 5, 10),
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 3000,
  });

  pool.on('error', (err) => {
    console.error(`[DB] Pool error for project ${project.slug}:`, err.message);
  });

  projectPools.set(project.id, pool);
  return pool;
}

// Admin pool: connects to the project DB as the main admin user (superuser).
// Used by the SQL editor so it has full access like Supabase's SQL editor.
function getProjectAdminPool(project) {
  if (projectAdminPools.has(project.id)) {
    return projectAdminPools.get(project.id);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER || 'vpc_admin',
    password: process.env.DB_PASSWORD,
    max: 3,
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 3000,
  });

  pool.on('error', (err) => {
    console.error(`[DB] Admin pool error for project ${project.slug}:`, err.message);
  });

  projectAdminPools.set(project.id, pool);
  return pool;
}

function removeProjectPool(projectId) {
  const pool = projectPools.get(projectId);
  if (pool) {
    pool.end().catch(() => {});
    projectPools.delete(projectId);
  }
  const adminPool = projectAdminPools.get(projectId);
  if (adminPool) {
    adminPool.end().catch(() => {});
    projectAdminPools.delete(projectId);
  }
}

async function getProjects(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM db_projects WHERE status != 'deleted' ORDER BY created_at DESC`
  );

  // Get storage usage for each project
  for (const project of rows) {
    try {
      const sizeResult = await pool.query(
        `SELECT pg_database_size($1) AS size_bytes`,
        [project.db_name]
      );
      project.storage_used_mb = Math.round(
        parseInt(sizeResult.rows[0]?.size_bytes || 0) / (1024 * 1024)
      );
    } catch {
      project.storage_used_mb = 0;
    }
  }

  return rows;
}

async function getProject(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT * FROM db_projects WHERE id = $1 AND status != 'deleted'`,
    [projectId]
  );
  return rows[0] || null;
}

async function getProjectBySlug(pool, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM db_projects WHERE slug = $1 AND status = 'active'`,
    [slug]
  );
  return rows[0] || null;
}

async function getProjectStats(pool, project) {
  const stats = { storage_used_mb: 0, active_connections: 0, auth_user_count: 0 };

  try {
    const sizeResult = await pool.query(
      `SELECT pg_database_size($1) AS size_bytes`,
      [project.db_name]
    );
    stats.storage_used_mb = Math.round(
      parseInt(sizeResult.rows[0]?.size_bytes || 0) / (1024 * 1024)
    );
  } catch {}

  try {
    const connResult = await pool.query(
      `SELECT count(*) AS cnt FROM pg_stat_activity WHERE datname = $1`,
      [project.db_name]
    );
    stats.active_connections = parseInt(connResult.rows[0]?.cnt || 0);
  } catch {}

  try {
    const projectPool = getProjectPool(project);
    const authResult = await projectPool.query(
      `SELECT count(*) AS cnt FROM auth_users`
    );
    stats.auth_user_count = parseInt(authResult.rows[0]?.cnt || 0);
  } catch {}

  return stats;
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function generateDbName(slug) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `db_${slug.replace(/-/g, '_').slice(0, 40)}_${suffix}`;
}

function generateDbUser(slug) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `db_${slug.replace(/-/g, '_').slice(0, 40)}_${suffix}`;
}

function generateDbPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

async function createProject(pool, { name, slug, storageLimitMb, maxConnections, createdBy }) {
  const dbName = generateDbName(slug);
  const dbUser = generateDbUser(slug);
  const dbPassword = generateDbPassword();

  // Create PostgreSQL user and database using the main pool (vpc_admin)
  // Must use template literal for CREATE USER/DATABASE (can't parameterize these)
  const escapedUser = dbUser.replace(/"/g, '""');
  const escapedDb = dbName.replace(/"/g, '""');
  const escapedPassword = dbPassword.replace(/'/g, "''");

  const client = await pool.connect();
  try {
    // Create user with connection limit
    await client.query(
      `CREATE USER "${escapedUser}" WITH PASSWORD '${escapedPassword}' CONNECTION LIMIT ${parseInt(maxConnections) || 10}`
    );

    // Create database owned by that user
    await client.query(`CREATE DATABASE "${escapedDb}" OWNER "${escapedUser}"`);

    // Record in db_projects
    const { rows } = await client.query(
      `INSERT INTO db_projects (name, slug, db_name, db_user, db_password, storage_limit_mb, max_connections, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, slug, dbName, dbUser, dbPassword, storageLimitMb || 500, maxConnections || 10, createdBy]
    );

    const project = rows[0];

    // Connect to the new database and set up auth schema
    const projectPool = getProjectPool(project);
    await projectPool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await projectPool.query(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        provider VARCHAR(32) NOT NULL DEFAULT 'email',
        provider_id VARCHAR(255),
        full_name VARCHAR(255),
        avatar_url TEXT,
        metadata JSONB DEFAULT '{}',
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await projectPool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS auth_users_provider_idx ON auth_users(provider, provider_id) WHERE provider_id IS NOT NULL`
    );
    await ensureAuthOAuthSchema(projectPool);

    // Set up storage tables
    await dbStorage.ensureStorageTables(projectPool);

    return project;
  } catch (err) {
    // Cleanup on failure
    try { await client.query(`DROP DATABASE IF EXISTS "${escapedDb}"`); } catch {}
    try { await client.query(`DROP USER IF EXISTS "${escapedUser}"`); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function deleteProject(pool, projectId, { force = false } = {}) {
  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');

  if (project.is_starred && !force) {
    const err = new Error(`"${project.name}" is starred (protected). Unstar it first to delete.`);
    err.code = 'PROJECT_STARRED';
    err.statusCode = 423; // Locked
    throw err;
  }

  // Close cached pool
  removeProjectPool(projectId);

  // Clean up storage files from disk
  dbStorage.deleteProjectDir(project.slug);

  const escapedDb = project.db_name.replace(/"/g, '""');
  const escapedUser = project.db_user.replace(/"/g, '""');

  // Terminate all connections to the database
  await pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid != pg_backend_pid()`,
    [project.db_name]
  );

  // Drop database and user
  await pool.query(`DROP DATABASE IF EXISTS "${escapedDb}"`);
  await pool.query(`DROP USER IF EXISTS "${escapedUser}"`);

  // Mark as deleted
  await pool.query(
    `UPDATE db_projects SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
    [projectId]
  );

  return { deleted: true };
}

async function deleteAllRows(pool, projectId) {
  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');

  if (project.is_starred) {
    const err = new Error(`"${project.name}" is starred (protected). Unstar it first to clear data.`);
    err.code = 'PROJECT_STARRED';
    err.statusCode = 423;
    throw err;
  }

  // Use admin pool (superuser) to bypass permission issues
  const adminPool = getProjectAdminPool(project);

  // Step 1: Get all user tables in public schema
  const { rows: tables } = await adminPool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);

  if (tables.length === 0) {
    return { cleared: true, tables_cleared: 0, message: 'No tables found' };
  }

  // Step 2: Get all foreign key relationships
  const { rows: fkRelations } = await adminPool.query(`
    SELECT
      tc.table_name AS dependent_table,
      ccu.table_name AS referenced_table
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.constraint_column_usage AS ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name != ccu.table_name
  `);

  // Step 3: Build dependency graph and topological sort
  // A table that references another table depends on it
  // We need to delete from dependent tables first, then referenced (independent) tables
  const tableNames = tables.map(t => t.table_name);
  const dependsOn = {}; // table -> set of tables it depends on (references)

  for (const t of tableNames) {
    dependsOn[t] = new Set();
  }

  for (const fk of fkRelations) {
    if (dependsOn[fk.dependent_table] && tableNames.includes(fk.referenced_table)) {
      dependsOn[fk.dependent_table].add(fk.referenced_table);
    }
  }

  // Topological sort (Kahn's algorithm) - independent tables come last
  const inDegree = {};
  const reverseAdj = {}; // referenced -> [dependents]

  for (const t of tableNames) {
    inDegree[t] = dependsOn[t].size;
    reverseAdj[t] = [];
  }

  for (const t of tableNames) {
    for (const dep of dependsOn[t]) {
      if (reverseAdj[dep]) {
        reverseAdj[dep].push(t);
      }
    }
  }

  // Tables with no dependencies (independent) go into the queue first
  // But we want to DELETE from dependent tables first, so we reverse the order
  const queue = tableNames.filter(t => inDegree[t] === 0);
  const sortedIndependentFirst = [];

  while (queue.length > 0) {
    const current = queue.shift();
    sortedIndependentFirst.push(current);
    for (const dependent of (reverseAdj[current] || [])) {
      inDegree[dependent]--;
      if (inDegree[dependent] === 0) {
        queue.push(dependent);
      }
    }
  }

  // Handle circular dependencies - add any remaining tables
  const sorted = tableNames.filter(t => !sortedIndependentFirst.includes(t));
  sortedIndependentFirst.push(...sorted);

  // Reverse: delete dependent (child) tables first, then independent (parent) tables
  const deleteOrder = sortedIndependentFirst.reverse();

  // Step 4: Delete all rows in order, wrapped in a transaction
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    const clearedTables = [];
    for (const tableName of deleteOrder) {
      const escapedTable = tableName.replace(/"/g, '""');
      const result = await client.query(`DELETE FROM "${escapedTable}"`);
      clearedTables.push({ table: tableName, rows_deleted: result.rowCount });
    }

    await client.query('COMMIT');

    return {
      cleared: true,
      tables_cleared: clearedTables.length,
      details: clearedTables,
      delete_order: deleteOrder,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Failed to clear data: ${err.message}`);
  } finally {
    client.release();
  }
}

async function setProjectStar(pool, projectId, { isStarred, starredBy }) {
  const { rows } = await pool.query(
    `UPDATE db_projects
       SET is_starred = $1,
           starred_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
           starred_by = CASE WHEN $1 THEN $2 ELSE NULL END,
           updated_at = NOW()
     WHERE id = $3 AND status != 'deleted'
     RETURNING id, name, slug, is_starred, starred_at, starred_by`,
    [!!isStarred, starredBy || null, projectId]
  );
  if (!rows[0]) throw new Error('Project not found');
  return rows[0];
}

async function updateProjectSettings(pool, projectId, { storageLimitMb, maxConnections }) {
  const updates = [];
  const values = [];
  let i = 1;

  if (storageLimitMb !== undefined) {
    updates.push(`storage_limit_mb = $${i++}`);
    values.push(storageLimitMb);
  }
  if (maxConnections !== undefined) {
    updates.push(`max_connections = $${i++}`);
    values.push(maxConnections);

    // Also update PG user connection limit
    const project = await getProject(pool, projectId);
    if (project) {
      const escapedUser = project.db_user.replace(/"/g, '""');
      await pool.query(`ALTER USER "${escapedUser}" CONNECTION LIMIT ${parseInt(maxConnections)}`);
    }
  }

  if (updates.length === 0) return null;

  updates.push(`updated_at = NOW()`);
  values.push(projectId);

  const { rows } = await pool.query(
    `UPDATE db_projects SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

// Self-healing migration: add OAuth fields to auth_users + auth_providers table.
// Idempotent — safe to call repeatedly. Existing projects pick up Google support
// the first time someone opens their Auth tab or hits an OAuth route.
const _oauthSchemaDone = new Set();
async function ensureAuthOAuthSchema(projectPool) {
  const cacheKey = projectPool.options?.database || JSON.stringify(projectPool.options || {});
  if (_oauthSchemaDone.has(cacheKey)) return;
  await projectPool.query(`ALTER TABLE auth_users ALTER COLUMN password_hash DROP NOT NULL`).catch(() => {});
  await projectPool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS provider VARCHAR(32) NOT NULL DEFAULT 'email'`);
  await projectPool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255)`);
  await projectPool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255)`);
  await projectPool.query(`ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
  await projectPool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS auth_users_provider_idx ON auth_users(provider, provider_id) WHERE provider_id IS NOT NULL`
  );
  await projectPool.query(`
    CREATE TABLE IF NOT EXISTS auth_providers (
      provider VARCHAR(32) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      client_id TEXT,
      client_secret_encrypted TEXT,
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  _oauthSchemaDone.add(cacheKey);
}

// Auth user management (operates on project database)
async function getAuthUsers(projectPool) {
  await ensureAuthOAuthSchema(projectPool);
  const { rows } = await projectPool.query(
    `SELECT id, email, is_active, provider, provider_id, full_name, avatar_url, metadata, last_login_at, created_at, updated_at
     FROM auth_users ORDER BY created_at DESC`
  );
  return rows;
}

async function createAuthUser(projectPool, { email, password }) {
  await ensureAuthOAuthSchema(projectPool);
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await projectPool.query(
    `INSERT INTO auth_users (email, password_hash, provider) VALUES ($1, $2, 'email')
     RETURNING id, email, is_active, provider, created_at`,
    [email, passwordHash]
  );
  return rows[0];
}

// Find or create a user from an OAuth provider profile. Links by provider_id first,
// then by email (so an email user signing in via Google promotes to OAuth). Returns
// the project user record suitable for token issuance.
async function findOrCreateOAuthUser(projectPool, { provider, providerId, email, fullName, avatarUrl }) {
  await ensureAuthOAuthSchema(projectPool);
  if (!provider || !providerId || !email) {
    throw new Error('provider, providerId and email are required');
  }

  // 1) Match by provider + provider_id (returning user)
  const { rows: byProvider } = await projectPool.query(
    `SELECT * FROM auth_users WHERE provider = $1 AND provider_id = $2`,
    [provider, providerId]
  );
  if (byProvider[0]) {
    const user = byProvider[0];
    if (!user.is_active) throw new Error('User account is disabled');
    await projectPool.query(
      `UPDATE auth_users
         SET email = $1, full_name = COALESCE($2, full_name), avatar_url = COALESCE($3, avatar_url),
             last_login_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [email, fullName || null, avatarUrl || null, user.id]
    );
    return { id: user.id, email, provider, full_name: fullName || user.full_name, avatar_url: avatarUrl || user.avatar_url, isNew: false };
  }

  // 2) Match by email — link existing email account to this OAuth identity
  const { rows: byEmail } = await projectPool.query(
    `SELECT * FROM auth_users WHERE email = $1`,
    [email]
  );
  if (byEmail[0]) {
    const user = byEmail[0];
    if (!user.is_active) throw new Error('User account is disabled');
    await projectPool.query(
      `UPDATE auth_users
         SET provider = $1, provider_id = $2,
             full_name = COALESCE($3, full_name), avatar_url = COALESCE($4, avatar_url),
             last_login_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [provider, providerId, fullName || null, avatarUrl || null, user.id]
    );
    return { id: user.id, email: user.email, provider, full_name: fullName || user.full_name, avatar_url: avatarUrl || user.avatar_url, isNew: false };
  }

  // 3) New OAuth user
  const { rows } = await projectPool.query(
    `INSERT INTO auth_users (email, provider, provider_id, full_name, avatar_url, last_login_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id, email, provider, full_name, avatar_url`,
    [email, provider, providerId, fullName || null, avatarUrl || null]
  );
  return { ...rows[0], isNew: true };
}

// Auth provider configuration (stored per project, in the project DB)
async function getAuthProviders(projectPool) {
  await ensureAuthOAuthSchema(projectPool);
  const { rows } = await projectPool.query(
    `SELECT provider, enabled, client_id, client_secret_encrypted, config, updated_at
       FROM auth_providers ORDER BY provider`
  );
  return rows.map((row) => ({
    provider: row.provider,
    enabled: row.enabled,
    client_id: row.client_id || '',
    has_client_secret: !!row.client_secret_encrypted,
    config: row.config || {},
    updated_at: row.updated_at,
  }));
}

async function setAuthProvider(projectPool, provider, { enabled, clientId, clientSecret, config }) {
  await ensureAuthOAuthSchema(projectPool);
  // Pull current row so an unspecified clientSecret doesn't wipe an existing one
  const { rows: existing } = await projectPool.query(
    `SELECT client_secret_encrypted FROM auth_providers WHERE provider = $1`,
    [provider]
  );
  const currentSecret = existing[0]?.client_secret_encrypted || null;
  const encryptedSecret = clientSecret
    ? encryptApiKey(clientSecret)
    : (clientSecret === '' ? null : currentSecret);

  const { rows } = await projectPool.query(
    `INSERT INTO auth_providers (provider, enabled, client_id, client_secret_encrypted, config, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (provider) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           client_id = EXCLUDED.client_id,
           client_secret_encrypted = EXCLUDED.client_secret_encrypted,
           config = EXCLUDED.config,
           updated_at = NOW()
     RETURNING provider, enabled, client_id, client_secret_encrypted, config, updated_at`,
    [provider, !!enabled, clientId || null, encryptedSecret, config || {}]
  );
  const row = rows[0];
  return {
    provider: row.provider,
    enabled: row.enabled,
    client_id: row.client_id || '',
    has_client_secret: !!row.client_secret_encrypted,
    config: row.config || {},
    updated_at: row.updated_at,
  };
}

async function getAuthProviderWithSecret(projectPool, provider) {
  await ensureAuthOAuthSchema(projectPool);
  const { rows } = await projectPool.query(
    `SELECT provider, enabled, client_id, client_secret_encrypted, config FROM auth_providers WHERE provider = $1`,
    [provider]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    provider: row.provider,
    enabled: row.enabled,
    client_id: row.client_id,
    client_secret: row.client_secret_encrypted ? decryptApiKey(row.client_secret_encrypted) : null,
    config: row.config || {},
  };
}

async function deleteAuthUser(projectPool, userId) {
  const { rowCount } = await projectPool.query(
    `DELETE FROM auth_users WHERE id = $1`,
    [userId]
  );
  return { deleted: rowCount > 0 };
}

async function toggleAuthUser(projectPool, userId) {
  const { rows } = await projectPool.query(
    `UPDATE auth_users SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1
     RETURNING id, email, is_active`,
    [userId]
  );
  return rows[0];
}

async function resetAuthUserPassword(projectPool, userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const { rows } = await projectPool.query(
    `UPDATE auth_users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, is_active`,
    [passwordHash, userId]
  );
  return rows[0];
}

async function authenticateAuthUser(projectPool, email, password) {
  const { rows } = await projectPool.query(
    `SELECT * FROM auth_users WHERE email = $1 AND is_active = true`,
    [email]
  );
  if (rows.length === 0) return null;

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  await projectPool.query(
    `UPDATE auth_users SET last_login_at = NOW() WHERE id = $1`,
    [user.id]
  );

  return { id: user.id, email: user.email, metadata: user.metadata };
}

// ── API Key encryption (for dashboard display like Supabase) ──────
const KEY_ENC_ALGO = 'aes-256-gcm';
const KEY_ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'db-default-key', 'db-key-salt', 32);

function encryptApiKey(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(KEY_ENC_ALGO, KEY_ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptApiKey(data) {
  try {
    const [ivHex, tagHex, encrypted] = data.split(':');
    const decipher = crypto.createDecipheriv(KEY_ENC_ALGO, KEY_ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

// Ensure encrypted_key column exists (self-healing migration)
let _columnEnsured = false;
async function ensureEncryptedKeyColumn(pool) {
  if (_columnEnsured) return;
  try {
    await pool.query('ALTER TABLE db_api_keys ADD COLUMN IF NOT EXISTS encrypted_key TEXT');
    _columnEnsured = true;
  } catch (err) {
    console.error('[DB] Failed to ensure encrypted_key column:', err.message);
  }
}

// API key management
function generateApiKey(role) {
  const prefixMap = { service: 'db_svc_', pull: 'db_pull_', anon: 'db_' };
  const prefix = prefixMap[role] || 'db_';
  const rawKey = prefix + crypto.randomBytes(32).toString('hex');
  const keyPrefix = rawKey.slice(prefix.length, prefix.length + 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyPrefix, keyHash };
}

async function getApiKeys(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, key_prefix, role, is_active, encrypted_key, created_at
     FROM db_api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    ...row,
    api_key: row.encrypted_key ? decryptApiKey(row.encrypted_key) : null,
    encrypted_key: undefined,
  }));
}

async function createApiKey(pool, projectId, { name, role }) {
  const { rawKey, keyPrefix, keyHash } = generateApiKey(role || 'anon');
  const encrypted = encryptApiKey(rawKey);
  const { rows } = await pool.query(
    `INSERT INTO db_api_keys (project_id, name, key_prefix, key_hash, role, encrypted_key)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, key_prefix, role, created_at`,
    [projectId, name, keyPrefix, keyHash, role || 'anon', encrypted]
  );
  return { ...rows[0], api_key: rawKey };
}

// Auto-create default anon + service keys if they don't exist
async function ensureDefaultKeys(pool, projectId) {
  await ensureEncryptedKeyColumn(pool);
  const existing = await getApiKeys(pool, projectId);
  const activeAnon = existing.find((k) => k.role === 'anon' && k.is_active);
  const activeService = existing.find((k) => k.role === 'service' && k.is_active);

  // If active key exists but has no encrypted_key (legacy), regenerate it
  if (activeAnon && !activeAnon.api_key) {
    await regenerateApiKey(pool, projectId, 'anon');
  } else if (!activeAnon) {
    await createApiKey(pool, projectId, { name: 'anon key', role: 'anon' });
  }

  if (activeService && !activeService.api_key) {
    await regenerateApiKey(pool, projectId, 'service');
  } else if (!activeService) {
    await createApiKey(pool, projectId, { name: 'service_role key', role: 'service' });
  }

  // Ensure pull key exists
  const activePull = existing.find((k) => k.role === 'pull' && k.is_active);
  if (activePull && !activePull.api_key) {
    await regenerateApiKey(pool, projectId, 'pull');
  } else if (!activePull) {
    await createApiKey(pool, projectId, { name: 'pull key', role: 'pull' });
  }

  // Return fresh list
  return getApiKeys(pool, projectId);
}

// Regenerate a key: revoke old, create new with same role
async function regenerateApiKey(pool, projectId, role) {
  // Revoke all active keys of this role
  await pool.query(
    `UPDATE db_api_keys SET is_active = false WHERE project_id = $1 AND role = $2 AND is_active = true`,
    [projectId, role]
  );
  const nameMap = { service: 'service_role key', pull: 'pull key', anon: 'anon key' };
  const name = nameMap[role] || 'anon key';
  return createApiKey(pool, projectId, { name, role });
}

async function revokeApiKey(pool, keyId) {
  const { rowCount } = await pool.query(
    `UPDATE db_api_keys SET is_active = false WHERE id = $1`,
    [keyId]
  );
  return { revoked: rowCount > 0 };
}

async function findProjectByApiKeyHash(pool, keyHash) {
  const { rows } = await pool.query(
    `SELECT bak.id AS api_key_id, bak.role, bp.*
     FROM db_api_keys bak
     JOIN db_projects bp ON bp.id = bak.project_id
     WHERE bak.key_hash = $1 AND bak.is_active = true AND bp.status = 'active'`,
    [keyHash]
  );
  return rows[0] || null;
}

// Storage summary: total server disk, total allocated across projects, total used
async function getStorageSummary(pool) {
  // Get total allocated and used across all projects
  const { rows: projects } = await pool.query(
    `SELECT id, db_name, storage_limit_mb FROM db_projects WHERE status != 'deleted'`
  );

  let totalAllocatedMb = 0;
  let totalUsedMb = 0;

  for (const p of projects) {
    totalAllocatedMb += p.storage_limit_mb || 0;
    try {
      const sizeResult = await pool.query(
        `SELECT pg_database_size($1) AS size_bytes`, [p.db_name]
      );
      totalUsedMb += Math.round(parseInt(sizeResult.rows[0]?.size_bytes || 0) / (1024 * 1024));
    } catch {}
  }

  // Get total PG data directory size (server-level)
  let serverTotalMb = 0;
  try {
    const diskResult = await pool.query(
      `SELECT pg_size_pretty(sum(pg_database_size(datname))) AS total_pretty,
              sum(pg_database_size(datname)) AS total_bytes
       FROM pg_database WHERE datistemplate = false`
    );
    serverTotalMb = Math.round(parseInt(diskResult.rows[0]?.total_bytes || 0) / (1024 * 1024));
  } catch {}

  return {
    total_allocated_mb: totalAllocatedMb,
    total_used_mb: totalUsedMb,
    remaining_allocatable_mb: Math.max(0, totalAllocatedMb - totalUsedMb),
    server_total_db_mb: serverTotalMb,
    project_count: projects.length,
  };
}

// Check if a project has exceeded its storage limit (DB + file storage)
async function checkStorageLimit(pool, project) {
  try {
    const sizeResult = await pool.query(
      `SELECT pg_database_size($1) AS size_bytes`, [project.db_name]
    );
    const dbUsedBytes = parseInt(sizeResult.rows[0]?.size_bytes || 0);

    // Include file storage on disk
    let fileUsedBytes = 0;
    try {
      const projectPool = getProjectPool(project);
      fileUsedBytes = await dbStorage.getFileSizeTotal(projectPool);
    } catch {}

    const totalUsedMb = Math.round((dbUsedBytes + fileUsedBytes) / (1024 * 1024));
    const limitMb = project.storage_limit_mb || 500;
    return {
      used_mb: totalUsedMb,
      db_used_mb: Math.round(dbUsedBytes / (1024 * 1024)),
      file_used_mb: Math.round(fileUsedBytes / (1024 * 1024)),
      limit_mb: limitMb,
      exceeded: totalUsedMb >= limitMb,
      remaining_mb: Math.max(0, limitMb - totalUsedMb),
    };
  } catch {
    return { used_mb: 0, limit_mb: project.storage_limit_mb || 500, exceeded: false, remaining_mb: project.storage_limit_mb || 500 };
  }
}

module.exports = {
  getProjectPool,
  getProjectAdminPool,
  removeProjectPool,
  getProjects,
  getProject,
  getProjectBySlug,
  getProjectStats,
  generateSlug,
  createProject,
  deleteProject,
  deleteAllRows,
  setProjectStar,
  updateProjectSettings,
  getAuthUsers,
  createAuthUser,
  deleteAuthUser,
  toggleAuthUser,
  resetAuthUserPassword,
  authenticateAuthUser,
  ensureAuthOAuthSchema,
  findOrCreateOAuthUser,
  getAuthProviders,
  setAuthProvider,
  getAuthProviderWithSecret,
  generateApiKey,
  getApiKeys,
  createApiKey,
  ensureDefaultKeys,
  regenerateApiKey,
  revokeApiKey,
  findProjectByApiKeyHash,
  getStorageSummary,
  checkStorageLimit,
  generateDbName,
  generateDbUser,
  generateDbPassword,
};
