const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Simple mime type detection from extension
const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.json': 'application/json', '.xml': 'application/xml',
  '.zip': 'application/zip', '.gz': 'application/gzip',
  '.csv': 'text/csv', '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}
const banadbService = require('../services/banadbService');
const banaStorage = require('../services/banaStorageService');

// GET /storage/v1/:slug/:bucketName/*
// Serves files from public buckets without authentication
router.get('/:slug/:bucketName/*', async (req, res) => {
  try {
    const { slug, bucketName } = req.params;
    const filePath = req.params[0]; // everything after bucketName/

    if (!filePath) return res.status(400).json({ error: 'File path is required' });

    // Look up project
    const project = await banadbService.getProjectBySlug(req.app.locals.pool, slug);
    if (!project) return res.status(404).json({ error: 'Not found' });

    // Get project pool and look up bucket
    const pool = banadbService.getProjectPool(project);
    const bucket = await banaStorage.getBucketByName(pool, bucketName);
    if (!bucket) return res.status(404).json({ error: 'Not found' });

    // Must be a public bucket
    if (!bucket.is_public) {
      return res.status(403).json({ error: 'This bucket is private. Use API key authentication.' });
    }

    // Find the object
    const obj = await banaStorage.getObjectByPath(pool, bucket.id, filePath);
    if (!obj) return res.status(404).json({ error: 'File not found' });

    // Check file exists on disk
    if (!fs.existsSync(obj.storage_path)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Serve file with correct content type
    const contentType = obj.mime_type || getMimeType(obj.name);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', obj.file_size);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    fs.createReadStream(obj.storage_path).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
