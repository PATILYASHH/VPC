const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const gallery = require('../services/galleryService');
const banadbService = require('../services/banadbService');
const banaStorage = require('../services/banaStorageService');

// Multer storage: keep original extension, use UUID filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    gallery.ensureUploadDir();
    cb(null, gallery.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// GET /files — list with filters
router.get('/files', async (req, res) => {
  try {
    const { category, folder, search, page, limit } = req.query;
    const result = await gallery.getFiles(req.app.locals.pool, {
      category,
      folder: folder || '/',
      search,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats — category counts + storage
router.get('/stats', async (req, res) => {
  try {
    const stats = await gallery.getStats(req.app.locals.pool);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /folders — list all folders
router.get('/folders', async (req, res) => {
  try {
    const folders = await gallery.getFolders(req.app.locals.pool);
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /upload — upload files (multi-file)
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const folder = req.body.folder || '/';
    const results = [];

    for (const file of req.files) {
      const record = await gallery.createFile(req.app.locals.pool, {
        filename: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileSize: file.size,
        mimeType: file.mimetype,
        folder,
        uploadedBy: req.admin?.id,
      });
      results.push(record);
    }

    res.status(201).json({ uploaded: results.length, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /files/:id/download — download file
router.get('/files/:id/download', async (req, res) => {
  try {
    const file = await gallery.getFile(req.app.locals.pool, req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.download(file.file_path, file.original_name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /files/:id/preview — serve inline for preview
router.get('/files/:id/preview', async (req, res) => {
  try {
    const file = await gallery.getFile(req.app.locals.pool, req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(file.file_path);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /files/:id — delete file
router.delete('/files/:id', async (req, res) => {
  try {
    const result = await gallery.deleteFile(req.app.locals.pool, req.params.id);
    if (!result.deleted) return res.status(404).json({ error: 'File not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /files/:id — rename or move file
router.patch('/files/:id', async (req, res) => {
  try {
    const { name, folder } = req.body;
    let file;

    if (name) {
      file = await gallery.renameFile(req.app.locals.pool, req.params.id, name);
    }
    if (folder !== undefined) {
      file = await gallery.moveFile(req.app.locals.pool, req.params.id, folder);
    }

    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json(file);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /folders — create virtual folder (just a marker)
router.post('/folders', async (req, res) => {
  try {
    const { name, parent } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });
    const folderPath = (parent && parent !== '/' ? `${parent}/${name}` : `/${name}`).replace(/\/+/g, '/');
    res.status(201).json({ folder: folderPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BanaDB Bucket Files in Gallery ──────────────────────

// GET /bucket-data — all projects with their buckets + file counts
router.get('/bucket-data', async (req, res) => {
  try {
    const projects = await banadbService.getProjects(req.app.locals.pool);
    const result = [];

    for (const project of projects) {
      try {
        const pool = banadbService.getProjectAdminPool(project);
        const buckets = await banaStorage.listBuckets(pool);
        if (buckets.length > 0) {
          result.push({
            id: project.id,
            name: project.name,
            slug: project.slug,
            buckets: buckets.map((b) => ({
              id: b.id,
              name: b.name,
              is_public: b.is_public,
              file_count: parseInt(b.file_count) || 0,
              total_size: parseInt(b.total_size) || 0,
            })),
          });
        }
      } catch {
        // Skip projects with connection issues
      }
    }

    res.json({ projects: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /bucket-files — list files from a specific bucket
router.get('/bucket-files', async (req, res) => {
  try {
    const { projectId, bucketId, search, sort = 'newest' } = req.query;
    if (!projectId || !bucketId) {
      return res.status(400).json({ error: 'projectId and bucketId are required' });
    }

    const project = await banadbService.getProject(req.app.locals.pool, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const pool = banadbService.getProjectAdminPool(project);
    const bucket = await banaStorage.getBucket(pool, bucketId);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });

    // Get all objects with sorting
    let orderBy = 'created_at DESC';
    if (sort === 'oldest') orderBy = 'created_at ASC';
    else if (sort === 'name') orderBy = 'name ASC';
    else if (sort === 'size') orderBy = 'file_size DESC';
    else if (sort === 'type') orderBy = 'mime_type ASC, name ASC';

    let whereExtra = '';
    const params = [bucketId];
    if (search) {
      whereExtra = ' AND name ILIKE $2';
      params.push(`%${search}%`);
    }

    const { rows } = await pool.query(
      `SELECT * FROM storage_objects WHERE bucket_id = $1${whereExtra} ORDER BY ${orderBy} LIMIT 500`,
      params
    );

    // Map to gallery-compatible format
    const files = rows.map((obj) => ({
      id: obj.id,
      original_name: obj.name.split('/').pop(),
      full_path: obj.name,
      file_size: parseInt(obj.file_size) || 0,
      mime_type: obj.mime_type || 'application/octet-stream',
      category: getCategory(obj.mime_type),
      created_at: obj.created_at,
      updated_at: obj.updated_at,
      storage_path: obj.storage_path,
      bucket_id: bucketId,
      bucket_name: bucket.name,
      project_id: project.id,
      project_slug: project.slug,
      is_public: bucket.is_public,
      public_url: bucket.is_public
        ? `/storage/v1/${project.slug}/${bucket.name}/${obj.name}`
        : null,
    }));

    res.json({ files, bucket, project: { id: project.id, name: project.name, slug: project.slug } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /bucket-files/:objectId/preview — serve bucket file inline for preview
router.get('/bucket-files/:objectId/preview', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const project = await banadbService.getProject(req.app.locals.pool, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const pool = banadbService.getProjectAdminPool(project);
    const obj = await banaStorage.getObject(pool, req.params.objectId);
    if (!obj) return res.status(404).json({ error: 'File not found' });

    const fs = require('fs');
    if (!fs.existsSync(obj.storage_path)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Type', obj.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(obj.storage_path).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getCategory(mimeType) {
  if (!mimeType) return 'others';
  if (mimeType.startsWith('image/')) return 'images';
  if (mimeType.startsWith('video/')) return 'videos';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('spreadsheet') ||
      mimeType.includes('presentation') || mimeType.includes('text/') || mimeType.includes('csv')) return 'docs';
  return 'others';
}

module.exports = router;
