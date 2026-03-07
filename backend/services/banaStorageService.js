const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, '..', '..', 'uploads', 'bana-storage');

// ─── Schema bootstrap ──────────────────────────────────

async function ensureStorageTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage_buckets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) UNIQUE NOT NULL,
      is_public BOOLEAN DEFAULT false,
      file_size_limit BIGINT DEFAULT NULL,
      allowed_mime_types TEXT[] DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS storage_objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id UUID NOT NULL REFERENCES storage_buckets(id) ON DELETE CASCADE,
      name VARCHAR(1000) NOT NULL,
      storage_path VARCHAR(2000) NOT NULL,
      file_size BIGINT DEFAULT 0,
      mime_type VARCHAR(255),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(bucket_id, name)
    )
  `);
}

// ─── Disk helpers ───────────────────────────────────────

function getUploadDir(projectSlug, bucketName) {
  return path.join(BASE_DIR, projectSlug, bucketName);
}

function ensureUploadDir(projectSlug, bucketName) {
  const dir = getUploadDir(projectSlug, bucketName);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function deleteUploadDir(projectSlug, bucketName) {
  const dir = getUploadDir(projectSlug, bucketName);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

function deleteProjectDir(projectSlug) {
  const dir = path.join(BASE_DIR, projectSlug);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

// ─── Buckets ────────────────────────────────────────────

async function listBuckets(pool) {
  await ensureStorageTables(pool);
  const { rows } = await pool.query(`
    SELECT b.*,
      (SELECT COUNT(*)::int FROM storage_objects WHERE bucket_id = b.id) AS file_count,
      (SELECT COALESCE(SUM(file_size), 0)::bigint FROM storage_objects WHERE bucket_id = b.id) AS total_size
    FROM storage_buckets b
    ORDER BY b.created_at DESC
  `);
  return rows;
}

async function getBucket(pool, bucketId) {
  const { rows } = await pool.query('SELECT * FROM storage_buckets WHERE id = $1', [bucketId]);
  return rows[0] || null;
}

async function getBucketByName(pool, name) {
  await ensureStorageTables(pool);
  const { rows } = await pool.query('SELECT * FROM storage_buckets WHERE name = $1', [name]);
  return rows[0] || null;
}

async function createBucket(pool, { name, isPublic, fileSizeLimit, allowedMimeTypes }) {
  await ensureStorageTables(pool);
  if (!name || !/^[a-z0-9][a-z0-9._-]{0,62}$/.test(name)) {
    throw new Error('Bucket name must be lowercase alphanumeric (a-z, 0-9, ., -, _), 1-63 chars');
  }
  const { rows } = await pool.query(
    `INSERT INTO storage_buckets (name, is_public, file_size_limit, allowed_mime_types)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, isPublic || false, fileSizeLimit || null, allowedMimeTypes || null]
  );
  return rows[0];
}

async function updateBucket(pool, bucketId, { isPublic, fileSizeLimit, allowedMimeTypes }) {
  const sets = [];
  const params = [];
  let idx = 1;

  if (isPublic !== undefined) { sets.push(`is_public = $${idx++}`); params.push(isPublic); }
  if (fileSizeLimit !== undefined) { sets.push(`file_size_limit = $${idx++}`); params.push(fileSizeLimit || null); }
  if (allowedMimeTypes !== undefined) { sets.push(`allowed_mime_types = $${idx++}`); params.push(allowedMimeTypes || null); }

  if (sets.length === 0) throw new Error('Nothing to update');

  sets.push(`updated_at = NOW()`);
  params.push(bucketId);

  const { rows } = await pool.query(
    `UPDATE storage_buckets SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

async function deleteBucket(pool, bucketId, projectSlug) {
  const bucket = await getBucket(pool, bucketId);
  if (!bucket) throw new Error('Bucket not found');

  // Remove all files from disk
  deleteUploadDir(projectSlug, bucket.name);

  // Cascade delete removes objects too
  await pool.query('DELETE FROM storage_buckets WHERE id = $1', [bucketId]);
  return { deleted: true, name: bucket.name };
}

// ─── Objects ────────────────────────────────────────────

async function listObjects(pool, bucketId, { prefix, search, limit = 100, offset = 0 } = {}) {
  const conditions = ['bucket_id = $1'];
  const params = [bucketId];
  let idx = 2;

  if (prefix) {
    conditions.push(`name LIKE $${idx++}`);
    params.push(`${prefix}%`);
  }
  if (search) {
    conditions.push(`name ILIKE $${idx++}`);
    params.push(`%${search}%`);
  }

  const where = conditions.join(' AND ');
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM storage_objects WHERE ${where}`, params
  );

  const { rows } = await pool.query(
    `SELECT * FROM storage_objects WHERE ${where}
     ORDER BY name ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, Math.min(parseInt(limit) || 100, 1000), parseInt(offset) || 0]
  );

  return { objects: rows, total: countResult.rows[0].total };
}

async function getObject(pool, objectId) {
  const { rows } = await pool.query('SELECT * FROM storage_objects WHERE id = $1', [objectId]);
  return rows[0] || null;
}

async function getObjectByPath(pool, bucketId, objectName) {
  const { rows } = await pool.query(
    'SELECT * FROM storage_objects WHERE bucket_id = $1 AND name = $2',
    [bucketId, objectName]
  );
  return rows[0] || null;
}

async function uploadObject(pool, { bucketId, name, file, projectSlug, bucketName }) {
  const storagePath = file.path;
  const { rows } = await pool.query(
    `INSERT INTO storage_objects (bucket_id, name, storage_path, file_size, mime_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bucket_id, name) DO UPDATE SET
       storage_path = EXCLUDED.storage_path,
       file_size = EXCLUDED.file_size,
       mime_type = EXCLUDED.mime_type,
       updated_at = NOW()
     RETURNING *`,
    [bucketId, name, storagePath, file.size, file.mimetype]
  );
  return rows[0];
}

async function deleteObject(pool, objectId) {
  const obj = await getObject(pool, objectId);
  if (!obj) return { deleted: false };

  // Remove from disk
  try {
    if (fs.existsSync(obj.storage_path)) {
      fs.unlinkSync(obj.storage_path);
    }
  } catch {}

  await pool.query('DELETE FROM storage_objects WHERE id = $1', [objectId]);
  return { deleted: true };
}

async function moveObject(pool, objectId, newName) {
  const { rows } = await pool.query(
    `UPDATE storage_objects SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newName, objectId]
  );
  return rows[0] || null;
}

// ─── Stats ──────────────────────────────────────────────

async function getStorageStats(pool) {
  await ensureStorageTables(pool);
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM storage_buckets) AS bucket_count,
      (SELECT COUNT(*)::int FROM storage_objects) AS total_files,
      (SELECT COALESCE(SUM(file_size), 0)::bigint FROM storage_objects) AS total_size
  `);
  return rows[0];
}

async function getFileSizeTotal(pool) {
  try {
    await ensureStorageTables(pool);
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(file_size), 0)::bigint AS total FROM storage_objects`
    );
    return parseInt(rows[0]?.total || 0);
  } catch {
    return 0;
  }
}

module.exports = {
  ensureStorageTables,
  getUploadDir,
  ensureUploadDir,
  deleteUploadDir,
  deleteProjectDir,
  listBuckets,
  getBucket,
  getBucketByName,
  createBucket,
  updateBucket,
  deleteBucket,
  listObjects,
  getObject,
  getObjectByPath,
  uploadObject,
  deleteObject,
  moveObject,
  getStorageStats,
  getFileSizeTotal,
};
