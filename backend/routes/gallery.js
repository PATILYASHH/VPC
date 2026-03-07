const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const gallery = require('../services/galleryService');

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

module.exports = router;
