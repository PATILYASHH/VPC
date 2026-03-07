const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'gallery');

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp'];
const DOC_EXTS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.ppt', '.pptx'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];

function detectCategory(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return 'images';
  if (DOC_EXTS.includes(ext)) return 'docs';
  if (VIDEO_EXTS.includes(ext)) return 'videos';
  return 'others';
}

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

async function getFiles(pool, { category, folder, search, page = 1, limit = 50 } = {}) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (category && category !== 'all') {
    conditions.push(`category = $${idx++}`);
    params.push(category);
  }
  if (folder) {
    conditions.push(`folder = $${idx++}`);
    params.push(folder);
  }
  if (search) {
    conditions.push(`original_name ILIKE $${idx++}`);
    params.push(`%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM gallery_files ${where}`, params);
  const total = countResult.rows[0].total;

  const { rows } = await pool.query(
    `SELECT * FROM gallery_files ${where} ORDER BY
       CASE WHEN folder != '/' THEN 0 ELSE 1 END,
       created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { files: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

async function getFile(pool, id) {
  const { rows } = await pool.query('SELECT * FROM gallery_files WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createFile(pool, { filename, originalName, filePath, fileSize, mimeType, folder, uploadedBy }) {
  const category = detectCategory(originalName);
  const { rows } = await pool.query(
    `INSERT INTO gallery_files (filename, original_name, file_path, file_size, mime_type, category, folder, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [filename, originalName, filePath, fileSize, mimeType, category, folder || '/', uploadedBy]
  );
  return rows[0];
}

async function deleteFile(pool, id) {
  const file = await getFile(pool, id);
  if (!file) return { deleted: false };

  // Remove from disk
  try {
    if (fs.existsSync(file.file_path)) {
      fs.unlinkSync(file.file_path);
    }
  } catch {
    // File may already be gone
  }

  await pool.query('DELETE FROM gallery_files WHERE id = $1', [id]);
  return { deleted: true };
}

async function renameFile(pool, id, newName) {
  const category = detectCategory(newName);
  const { rows } = await pool.query(
    `UPDATE gallery_files SET original_name = $1, category = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [newName, category, id]
  );
  return rows[0] || null;
}

async function moveFile(pool, id, newFolder) {
  const { rows } = await pool.query(
    `UPDATE gallery_files SET folder = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newFolder, id]
  );
  return rows[0] || null;
}

async function getFolders(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT folder, COUNT(*)::int AS file_count FROM gallery_files GROUP BY folder ORDER BY folder`
  );
  return rows;
}

async function getStats(pool) {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int AS total_files,
      COALESCE(SUM(file_size), 0)::bigint AS total_size,
      COUNT(*) FILTER (WHERE category = 'images')::int AS images,
      COUNT(*) FILTER (WHERE category = 'docs')::int AS docs,
      COUNT(*) FILTER (WHERE category = 'videos')::int AS videos,
      COUNT(*) FILTER (WHERE category = 'others')::int AS others
    FROM gallery_files
  `);
  return rows[0];
}

module.exports = {
  UPLOAD_DIR,
  detectCategory,
  ensureUploadDir,
  getFiles,
  getFile,
  createFile,
  deleteFile,
  renameFile,
  moveFile,
  getFolders,
  getStats,
};
