const express = require('express');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const dbService = require('../services/dbService');
const dbBrowser = require('../services/dbBrowserService');
const supabaseImport = require('../services/supabaseImportService');
const syncService = require('../services/syncService');
const dbStorage = require('../services/dbStorageService');
const dbForkService = require('../services/dbForkService');
const prService = require('../services/prService');

// ─── Projects ──────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    const projects = await dbService.getProjects(req.app.locals.pool);
    const storage = await dbService.getStorageSummary(req.app.locals.pool);
    res.json({ projects, storage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const { name, storageLimitMb, maxConnections } = req.body;
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    }

    let slug = req.body.slug || dbService.generateSlug(name);
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);

    const project = await dbService.createProject(req.app.locals.pool, {
      name,
      slug,
      storageLimitMb: storageLimitMb || 500,
      maxConnections: maxConnections || 10,
      createdBy: req.admin.id,
    });

    res.status(201).json({ project });
  } catch (err) {
    if (err.message.includes('duplicate key') || err.code === '23505') {
      return res.status(409).json({ error: 'A project with this slug already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await dbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const stats = await dbService.getProjectStats(req.app.locals.pool, project);
    res.json({ project, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    if (!req.body.confirm) {
      return res.json({ requiresConfirmation: true });
    }
    const result = await dbService.deleteProject(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.code === 'PROJECT_STARRED') {
      return res.status(err.statusCode || 423).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: err.message });
  }
});

// Star / unstar a project (starred = protected, cannot be deleted)
router.put('/projects/:id/star', async (req, res) => {
  try {
    const result = await dbService.setProjectStar(req.app.locals.pool, req.params.id, {
      isStarred: !!req.body.isStarred,
      starredBy: req.admin?.username || null,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/rows', async (req, res) => {
  try {
    if (!req.body.confirm) {
      return res.json({ requiresConfirmation: true });
    }
    const result = await dbService.deleteAllRows(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.code === 'PROJECT_STARRED') {
      return res.status(err.statusCode || 423).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id/settings', async (req, res) => {
  try {
    const { storageLimitMb, maxConnections } = req.body;
    const project = await dbService.updateProjectSettings(
      req.app.locals.pool, req.params.id, { storageLimitMb, maxConnections }
    );
    res.json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Database Operations (reuse dbBrowserService) ──

// Middleware: resolve project and attach pool
async function resolveProject(req, res, next) {
  try {
    const project = await dbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    req.dbProject = project;
    req.dbPool = dbService.getProjectPool(project);
    req.dbAdminPool = dbService.getProjectAdminPool(project);
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Middleware: enforce per-project storage limit on write operations
async function enforceStorageLimit(req, res, next) {
  try {
    const check = await dbService.checkStorageLimit(req.app.locals.pool, req.dbProject);
    if (check.exceeded) {
      return res.status(507).json({
        error: `Storage limit exceeded (${check.used_mb}/${check.limit_mb} MB). Increase the limit in Settings or delete data.`,
        storage: check,
      });
    }
    next();
  } catch {
    next();
  }
}

router.get('/projects/:id/schemas', resolveProject, async (req, res) => {
  try {
    const schemas = await dbBrowser.getSchemas(req.dbPool);
    res.json({ schemas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/tables', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const tables = await dbBrowser.getTables(req.dbPool, schema);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/table/:name/columns', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const columns = await dbBrowser.getColumns(req.dbPool, schema, req.params.name);
    res.json({ columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/table/:name', resolveProject, async (req, res) => {
  try {
    const { schema = 'public', page = 1, pageSize = 50, sortBy, sortDir, filters } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const data = await dbBrowser.getTableData(req.dbPool, {
      schema,
      table: req.params.name,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      offset,
      sortBy,
      sortDir,
      filters,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/fix-ownership', resolveProject, async (req, res) => {
  try {
    await syncService.fixOwnership(req.dbProject);
    res.json({ success: true, message: 'Table ownership reassigned to project user' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/query', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const { sql, confirm } = req.body;
    if (!sql) return res.status(400).json({ error: 'SQL is required' });
    // Use admin pool (superuser) for SQL editor — full access like Supabase
    const adminPool = dbService.getProjectAdminPool(req.dbProject);
    const result = await dbBrowser.executeEditorQuery(adminPool, sql, !!confirm);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/table/:name/row', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const row = await dbBrowser.insertRow(req.dbPool, schema, req.params.name, req.body);
    res.status(201).json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/projects/:id/table/:name/row/:rowId', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const primaryKey = req.query.primaryKey || 'id';
    const row = await dbBrowser.updateRow(req.dbPool, schema, req.params.name, primaryKey, req.params.rowId, req.body);
    res.json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/table/:name/row/:rowId', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const primaryKey = req.query.primaryKey || 'id';
    const result = await dbBrowser.deleteRow(req.dbPool, schema, req.params.name, primaryKey, req.params.rowId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auth User Management ──────────────────────────────────

router.get('/projects/:id/auth/users', resolveProject, async (req, res) => {
  try {
    const users = await dbService.getAuthUsers(req.dbPool);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/auth/users', resolveProject, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await dbService.createAuthUser(req.dbPool, { email, password });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id/auth/users/:userId', resolveProject, async (req, res) => {
  try {
    const user = await dbService.toggleAuthUser(req.dbPool, req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/auth/users/:userId', resolveProject, async (req, res) => {
  try {
    const result = await dbService.deleteAuthUser(req.dbPool, req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auth Provider Config (Google, etc.) ────────────────────

router.get('/projects/:id/auth/providers', resolveProject, async (req, res) => {
  try {
    const providers = await dbService.getAuthProviders(req.dbPool);
    // Build the public callback URL the user must register with their OAuth provider
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const callbackBase = `${proto}://${host}/api/db/auth/v1/${encodeURIComponent(req.dbProject.slug)}/callback`;
    res.json({
      providers,
      callback_base_url: callbackBase,
      authorize_base_url: `${proto}://${host}/api/db/auth/v1/${encodeURIComponent(req.dbProject.slug)}/authorize`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/projects/:id/auth/providers/:provider', resolveProject, async (req, res) => {
  try {
    const provider = req.params.provider;
    if (!['google', 'github'].includes(provider)) {
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    }
    const { enabled, clientId, clientSecret, config } = req.body;
    if (enabled && (!clientId || (!clientSecret && req.body.clientSecret !== undefined && clientSecret === ''))) {
      return res.status(400).json({ error: 'clientId and clientSecret are required to enable a provider' });
    }
    const result = await dbService.setAuthProvider(req.dbPool, provider, {
      enabled,
      clientId,
      clientSecret,
      config,
    });
    res.json({ provider: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/projects/:id/auth/users/:userId/password', resolveProject, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = await dbService.resetAuthUserPassword(req.dbPool, req.params.userId, password);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Keys ──────────────────────────────────────────────

router.get('/projects/:id/api-keys', async (req, res) => {
  try {
    // Auto-create default anon + service keys if missing
    const keys = await dbService.ensureDefaultKeys(req.app.locals.pool, req.params.id);
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys', async (req, res) => {
  try {
    const { name, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });
    const result = await dbService.createApiKey(req.app.locals.pool, req.params.id, { name, role });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys/regenerate', async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['anon', 'service', 'pull'].includes(role)) {
      return res.status(400).json({ error: 'Role must be anon, service, or pull' });
    }
    const result = await dbService.regenerateApiKey(req.app.locals.pool, req.params.id, role);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/api-keys/:keyId', async (req, res) => {
  try {
    const result = await dbService.revokeApiKey(req.app.locals.pool, req.params.keyId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pull Tracking ────────────────────────────────────────

router.post('/projects/:id/pull/enable', resolveProject, async (req, res) => {
  try {
    const pullService = require('../services/pullService');
    const result = await pullService.installPullTracking(req.app.locals.pool, req.dbProject);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull/disable', resolveProject, async (req, res) => {
  try {
    const pullService = require('../services/pullService');
    const result = await pullService.uninstallPullTracking(req.app.locals.pool, req.dbProject);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/pull/status', resolveProject, async (req, res) => {
  try {
    const pullService = require('../services/pullService');
    const status = await pullService.getPullTrackingStatus(req.app.locals.pool, req.dbProject);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Supabase Import & Sync ───────────────────────────────

router.post('/projects/:id/import/test-connection', async (req, res) => {
  try {
    const { connectionString } = req.body;
    if (!connectionString) return res.status(400).json({ error: 'Connection string is required' });
    const result = await supabaseImport.testConnection(connectionString);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/import/supabase', resolveProject, async (req, res) => {
  try {
    const { connectionString, importAuth } = req.body;
    if (!connectionString) return res.status(400).json({ error: 'Connection string is required' });

    const jobId = supabaseImport.startImport(
      req.app.locals.pool,
      req.dbProject,
      { connectionString, importAuth: importAuth !== false }
    );
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync: pull latest changes from linked Supabase
router.post('/projects/:id/import/sync', resolveProject, async (req, res) => {
  try {
    const jobId = await supabaseImport.startSync(
      req.app.locals.pool,
      req.dbProject
    );
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get import/sync job status (polling endpoint)
router.get('/projects/:id/import/job/:jobId', async (req, res) => {
  const job = supabaseImport.getJobStatus(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Get link status
router.get('/projects/:id/import/status', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT supabase_connection IS NOT NULL AS linked, last_sync_at, sync_status
       FROM db_projects WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Project not found' });

    let remoteInfo = null;
    if (rows[0].linked) {
      try {
        const connStr = await supabaseImport.getConnection(req.app.locals.pool, req.params.id);
        remoteInfo = await supabaseImport.testConnection(connStr);
      } catch {}
    }

    res.json({
      linked: rows[0].linked,
      last_sync_at: rows[0].last_sync_at,
      sync_status: rows[0].sync_status,
      remote: remoteInfo,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect: remove stored connection
router.delete('/projects/:id/import/disconnect', async (req, res) => {
  try {
    await supabaseImport.removeConnection(req.app.locals.pool, req.params.id);
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Storage / Buckets ────────────────────────────────────

// Multer config for bucket uploads (dynamic destination per project/bucket)
function createBucketUpload() {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = dbStorage.ensureUploadDir(req.dbProject.slug, req._bucketName);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  });
  return multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB
}

const bucketUpload = createBucketUpload();

// Middleware: resolve bucket and attach name for multer
async function resolveBucket(req, res, next) {
  try {
    const bucket = await dbStorage.getBucket(req.dbAdminPool, req.params.bucketId);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    req._bucket = bucket;
    req._bucketName = bucket.name;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// List buckets
router.get('/projects/:id/storage/buckets', resolveProject, async (req, res) => {
  try {
    const buckets = await dbStorage.listBuckets(req.dbAdminPool);
    res.json({ buckets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create bucket
router.post('/projects/:id/storage/buckets', resolveProject, async (req, res) => {
  try {
    const { name, isPublic, fileSizeLimit, allowedMimeTypes } = req.body;
    if (!name) return res.status(400).json({ error: 'Bucket name is required' });
    const bucket = await dbStorage.createBucket(req.dbAdminPool, { name, isPublic, fileSizeLimit, allowedMimeTypes });
    res.status(201).json({ bucket });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Bucket name already exists' });
    res.status(400).json({ error: err.message });
  }
});

// Update bucket
router.patch('/projects/:id/storage/buckets/:bucketId', resolveProject, async (req, res) => {
  try {
    const bucket = await dbStorage.updateBucket(req.dbAdminPool, req.params.bucketId, req.body);
    if (!bucket) return res.status(404).json({ error: 'Bucket not found' });
    res.json({ bucket });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete bucket
router.delete('/projects/:id/storage/buckets/:bucketId', resolveProject, async (req, res) => {
  try {
    const result = await dbStorage.deleteBucket(req.dbAdminPool, req.params.bucketId, req.dbProject.slug);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List objects in bucket
router.get('/projects/:id/storage/buckets/:bucketId/objects', resolveProject, resolveBucket, async (req, res) => {
  try {
    const { prefix, search, limit, offset } = req.query;
    const data = await dbStorage.listObjects(req.dbAdminPool, req.params.bucketId, { prefix, search, limit, offset });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload file to bucket
router.post('/projects/:id/storage/buckets/:bucketId/upload', resolveProject, enforceStorageLimit, resolveBucket,
  bucketUpload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'File is required' });

      // Check bucket mime type restrictions
      const bucket = req._bucket;
      if (bucket.allowed_mime_types && bucket.allowed_mime_types.length > 0) {
        if (!bucket.allowed_mime_types.includes(req.file.mimetype)) {
          // Remove uploaded file
          try { require('fs').unlinkSync(req.file.path); } catch {}
          return res.status(400).json({ error: `File type ${req.file.mimetype} not allowed in this bucket` });
        }
      }

      // Check bucket file size limit
      if (bucket.file_size_limit && req.file.size > bucket.file_size_limit) {
        try { require('fs').unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ error: `File exceeds bucket size limit of ${Math.round(bucket.file_size_limit / (1024 * 1024))}MB` });
      }

      const objectName = req.body.path
        ? `${req.body.path.replace(/^\/|\/$/g, '')}/${req.file.originalname}`
        : req.file.originalname;

      const obj = await dbStorage.uploadObject(req.dbAdminPool, {
        bucketId: req.params.bucketId,
        name: objectName,
        file: req.file,
        projectSlug: req.dbProject.slug,
        bucketName: bucket.name,
      });

      res.status(201).json({ object: obj });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Download object
router.get('/projects/:id/storage/objects/:objectId/download', resolveProject, async (req, res) => {
  try {
    const obj = await dbStorage.getObject(req.dbAdminPool, req.params.objectId);
    if (!obj) return res.status(404).json({ error: 'Object not found' });
    if (!require('fs').existsSync(obj.storage_path)) return res.status(404).json({ error: 'File not found on disk' });
    res.download(obj.storage_path, path.basename(obj.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete object
router.delete('/projects/:id/storage/objects/:objectId', resolveProject, async (req, res) => {
  try {
    const result = await dbStorage.deleteObject(req.dbAdminPool, req.params.objectId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Storage stats
router.get('/projects/:id/storage/stats', resolveProject, async (req, res) => {
  try {
    const stats = await dbStorage.getStorageStats(req.dbAdminPool);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Project Backups ─────────────────────────────────────────

const backupService = require('../services/backupService');

// List backups for a project
router.get('/projects/:id/backups', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows: project } = await pool.query('SELECT db_name, name FROM db_projects WHERE id = $1', [req.params.id]);
    if (!project[0]) return res.status(404).json({ error: 'Project not found' });

    const { rows } = await pool.query(
      `SELECT * FROM backups WHERE database_name = $1 ORDER BY created_at DESC LIMIT 50`,
      [project[0].db_name]
    );
    res.json({ backups: rows, projectName: project[0].name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create backup for a project
router.post('/projects/:id/backups', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows: project } = await pool.query('SELECT db_name, name FROM db_projects WHERE id = $1', [req.params.id]);
    if (!project[0]) return res.status(404).json({ error: 'Project not found' });

    const result = await backupService.runBackup(pool, {
      database: project[0].db_name,
      backupType: req.body.backupType || 'full',
      initiatedBy: req.admin.id,
      notes: req.body.notes || `Manual backup of ${project[0].name}`,
    });
    res.json({ backup: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore backup for a project
router.post('/projects/:id/backups/:backupId/restore', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await backupService.restore(pool, req.params.backupId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download backup
router.get('/projects/:id/backups/:backupId/download', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [req.params.backupId]);
    if (!rows[0]) return res.status(404).json({ error: 'Backup not found' });
    const fs = require('fs');
    if (!fs.existsSync(rows[0].file_path)) return res.status(404).json({ error: 'Backup file not found' });
    res.download(rows[0].file_path, rows[0].filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete backup
router.delete('/projects/:id/backups/:backupId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [req.params.backupId]);
    if (!rows[0]) return res.status(404).json({ error: 'Backup not found' });
    const fs = require('fs');
    if (fs.existsSync(rows[0].file_path)) fs.unlinkSync(rows[0].file_path);
    await pool.query('DELETE FROM backups WHERE id = $1', [req.params.backupId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get auto-backup schedule for a project
router.get('/projects/:id/backup-schedule', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      "SELECT value FROM vpc_settings WHERE key = $1",
      [`backup_schedule_${req.params.id}`]
    );
    const schedule = rows[0]?.value ? JSON.parse(rows[0].value) : { enabled: false, interval: 'daily', keepCount: 7 };
    res.json(schedule);
  } catch (err) {
    res.json({ enabled: false, interval: 'daily', keepCount: 7 });
  }
});

// Set auto-backup schedule for a project
router.post('/projects/:id/backup-schedule', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { enabled, interval, keepCount } = req.body;
    const value = JSON.stringify({
      enabled: !!enabled,
      interval: interval || 'daily', // hourly, daily, weekly, monthly
      keepCount: keepCount || 7,
      updatedAt: new Date().toISOString(),
    });
    await pool.query(
      `INSERT INTO vpc_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [`backup_schedule_${req.params.id}`, value]
    );
    res.json({ enabled: !!enabled, interval, keepCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fork & Promote ──────────────────────────────────────────

// Fork a project into a beta/dev environment
router.post('/projects/:id/fork', resolveProject, async (req, res) => {
  try {
    const { name, slug, copyData, environment } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const validEnvs = ['production', 'beta', 'development', 'staging'];
    if (environment && !validEnvs.includes(environment)) {
      return res.status(400).json({ error: `Environment must be one of: ${validEnvs.join(', ')}` });
    }
    const project = await dbForkService.forkProject(req.app.locals.pool, req.params.id, {
      name,
      slug: slug || dbService.generateSlug(name),
      copyData: copyData === undefined ? true : !!copyData,
      environment: environment || 'beta',
    });
    res.status(201).json({ project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List forks of a project
router.get('/projects/:id/forks', resolveProject, async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      "SELECT * FROM db_projects WHERE forked_from = $1 AND status != 'deleted' ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json({ forks: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Schema diff between two projects (source = prod, target = beta)
router.get('/projects/:id/diff/:targetId', resolveProject, async (req, res) => {
  try {
    const targetProject = await dbService.getProject(req.app.locals.pool, req.params.targetId);
    if (!targetProject) return res.status(404).json({ error: 'Target project not found' });

    const sourcePool = dbService.getProjectPool(req.dbProject);
    const targetPool = dbService.getProjectPool(targetProject);

    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      syncService.getSchemaSnapshot(sourcePool),
      syncService.getSchemaSnapshot(targetPool),
    ]);

    const diff = dbForkService.diffSchemas(sourceSnapshot, targetSnapshot);
    const sql = dbForkService.generatePromoteSQL(diff);

    res.json({
      diff,
      sql,
      source: { id: req.dbProject.id, name: req.dbProject.name, environment: req.dbProject.environment },
      target: { id: targetProject.id, name: targetProject.name, environment: targetProject.environment },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promote: create a PR on prod project from beta diff
router.post('/projects/:id/promote/:targetId', resolveProject, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const prodProject = req.dbProject; // :id = production target
    const betaProject = await dbService.getProject(pool, req.params.targetId);
    if (!betaProject) return res.status(404).json({ error: 'Beta project not found' });

    // Compute diff: what's in beta but not in prod
    const [prodSnapshot, betaSnapshot] = await Promise.all([
      syncService.getSchemaSnapshot(dbService.getProjectPool(prodProject)),
      syncService.getSchemaSnapshot(dbService.getProjectPool(betaProject)),
    ]);

    const diff = dbForkService.diffSchemas(prodSnapshot, betaSnapshot);
    const sql = dbForkService.generatePromoteSQL(diff);

    if (!sql.trim()) {
      return res.json({ message: 'No schema changes to promote', diff });
    }

    // Create PR on production project using existing PR system
    const pr = await prService.createPullRequest(pool, {
      projectId: prodProject.id,
      title: req.body.title || `Promote from ${betaProject.name}`,
      description: req.body.description ||
        `Schema changes from ${betaProject.environment || 'beta'} environment "${betaProject.name}".\n\n` +
        `New tables: ${diff.summary.newTables}, New columns: ${diff.summary.newColumns}, New indexes: ${diff.summary.newIndexes}`,
      sqlContent: sql,
      submittedBy: req.admin?.username || 'fork-promote',
    });

    res.status(201).json({ pr, diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update environment label
router.patch('/projects/:id/environment', resolveProject, async (req, res) => {
  try {
    const { environment } = req.body;
    const validEnvs = ['production', 'beta', 'development', 'staging'];
    if (!validEnvs.includes(environment)) {
      return res.status(400).json({ error: `Environment must be one of: ${validEnvs.join(', ')}` });
    }
    await req.app.locals.pool.query(
      'UPDATE db_projects SET environment = $1, updated_at = NOW() WHERE id = $2',
      [environment, req.params.id]
    );
    res.json({ updated: true, environment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
