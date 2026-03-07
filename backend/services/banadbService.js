const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// In-memory pool cache for project databases
const projectPools = new Map();

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
    console.error(`[BanaDB] Pool error for project ${project.slug}:`, err.message);
  });

  projectPools.set(project.id, pool);
  return pool;
}

function removeProjectPool(projectId) {
  const pool = projectPools.get(projectId);
  if (pool) {
    pool.end().catch(() => {});
    projectPools.delete(projectId);
  }
}

async function getProjects(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM bana_projects WHERE status != 'deleted' ORDER BY created_at DESC`
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
    `SELECT * FROM bana_projects WHERE id = $1 AND status != 'deleted'`,
    [projectId]
  );
  return rows[0] || null;
}

async function getProjectBySlug(pool, slug) {
  const { rows } = await pool.query(
    `SELECT * FROM bana_projects WHERE slug = $1 AND status = 'active'`,
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
  return `bana_${slug.replace(/-/g, '_').slice(0, 40)}_${suffix}`;
}

function generateDbUser(slug) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `bana_${slug.replace(/-/g, '_').slice(0, 40)}_${suffix}`;
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

    // Record in bana_projects
    const { rows } = await client.query(
      `INSERT INTO bana_projects (name, slug, db_name, db_user, db_password, storage_limit_mb, max_connections, created_by)
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
        password_hash VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}',
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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

async function deleteProject(pool, projectId) {
  const project = await getProject(pool, projectId);
  if (!project) throw new Error('Project not found');

  // Close cached pool
  removeProjectPool(projectId);

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
    `UPDATE bana_projects SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
    [projectId]
  );

  return { deleted: true };
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
    `UPDATE bana_projects SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0];
}

// Auth user management (operates on project database)
async function getAuthUsers(projectPool) {
  const { rows } = await projectPool.query(
    `SELECT id, email, is_active, metadata, last_login_at, created_at, updated_at
     FROM auth_users ORDER BY created_at DESC`
  );
  return rows;
}

async function createAuthUser(projectPool, { email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await projectPool.query(
    `INSERT INTO auth_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, is_active, created_at`,
    [email, passwordHash]
  );
  return rows[0];
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
const KEY_ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'bana-default-key', 'bana-key-salt', 32);

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
    await pool.query('ALTER TABLE bana_api_keys ADD COLUMN IF NOT EXISTS encrypted_key TEXT');
    _columnEnsured = true;
  } catch (err) {
    console.error('[BanaDB] Failed to ensure encrypted_key column:', err.message);
  }
}

// API key management
function generateApiKey(role) {
  const prefixMap = { service: 'bana_svc_', pull: 'bana_pull_', anon: 'bana_' };
  const prefix = prefixMap[role] || 'bana_';
  const rawKey = prefix + crypto.randomBytes(32).toString('hex');
  const keyPrefix = rawKey.slice(prefix.length, prefix.length + 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyPrefix, keyHash };
}

async function getApiKeys(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, key_prefix, role, is_active, encrypted_key, created_at
     FROM bana_api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
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
    `INSERT INTO bana_api_keys (project_id, name, key_prefix, key_hash, role, encrypted_key)
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
    `UPDATE bana_api_keys SET is_active = false WHERE project_id = $1 AND role = $2 AND is_active = true`,
    [projectId, role]
  );
  const nameMap = { service: 'service_role key', pull: 'pull key', anon: 'anon key' };
  const name = nameMap[role] || 'anon key';
  return createApiKey(pool, projectId, { name, role });
}

async function revokeApiKey(pool, keyId) {
  const { rowCount } = await pool.query(
    `UPDATE bana_api_keys SET is_active = false WHERE id = $1`,
    [keyId]
  );
  return { revoked: rowCount > 0 };
}

async function findProjectByApiKeyHash(pool, keyHash) {
  const { rows } = await pool.query(
    `SELECT bak.id AS api_key_id, bak.role, bp.*
     FROM bana_api_keys bak
     JOIN bana_projects bp ON bp.id = bak.project_id
     WHERE bak.key_hash = $1 AND bak.is_active = true AND bp.status = 'active'`,
    [keyHash]
  );
  return rows[0] || null;
}

// Storage summary: total server disk, total allocated across projects, total used
async function getStorageSummary(pool) {
  // Get total allocated and used across all projects
  const { rows: projects } = await pool.query(
    `SELECT id, db_name, storage_limit_mb FROM bana_projects WHERE status != 'deleted'`
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

// Check if a project has exceeded its storage limit
async function checkStorageLimit(pool, project) {
  try {
    const sizeResult = await pool.query(
      `SELECT pg_database_size($1) AS size_bytes`, [project.db_name]
    );
    const usedMb = Math.round(parseInt(sizeResult.rows[0]?.size_bytes || 0) / (1024 * 1024));
    const limitMb = project.storage_limit_mb || 500;
    return {
      used_mb: usedMb,
      limit_mb: limitMb,
      exceeded: usedMb >= limitMb,
      remaining_mb: Math.max(0, limitMb - usedMb),
    };
  } catch {
    return { used_mb: 0, limit_mb: project.storage_limit_mb || 500, exceeded: false, remaining_mb: project.storage_limit_mb || 500 };
  }
}

module.exports = {
  getProjectPool,
  removeProjectPool,
  getProjects,
  getProject,
  getProjectBySlug,
  getProjectStats,
  generateSlug,
  createProject,
  deleteProject,
  updateProjectSettings,
  getAuthUsers,
  createAuthUser,
  deleteAuthUser,
  toggleAuthUser,
  authenticateAuthUser,
  generateApiKey,
  getApiKeys,
  createApiKey,
  ensureDefaultKeys,
  regenerateApiKey,
  revokeApiKey,
  findProjectByApiKeyHash,
  getStorageSummary,
  checkStorageLimit,
};
