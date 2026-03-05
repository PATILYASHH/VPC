const express = require('express');
const router = express.Router();
const banadbService = require('../services/banadbService');
const dbBrowser = require('../services/dbBrowserService');
const supabaseImport = require('../services/supabaseImportService');

// ─── Projects ──────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    const projects = await banadbService.getProjects(req.app.locals.pool);
    const storage = await banadbService.getStorageSummary(req.app.locals.pool);
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

    let slug = req.body.slug || banadbService.generateSlug(name);
    slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);

    const project = await banadbService.createProject(req.app.locals.pool, {
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
    const project = await banadbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const stats = await banadbService.getProjectStats(req.app.locals.pool, project);
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
    const result = await banadbService.deleteProject(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id/settings', async (req, res) => {
  try {
    const { storageLimitMb, maxConnections } = req.body;
    const project = await banadbService.updateProjectSettings(
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
    const project = await banadbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    req.banaProject = project;
    req.banaPool = banadbService.getProjectPool(project);
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Middleware: enforce per-project storage limit on write operations
async function enforceStorageLimit(req, res, next) {
  try {
    const check = await banadbService.checkStorageLimit(req.app.locals.pool, req.banaProject);
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
    const schemas = await dbBrowser.getSchemas(req.banaPool);
    res.json({ schemas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/tables', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const tables = await dbBrowser.getTables(req.banaPool, schema);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/table/:name/columns', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const columns = await dbBrowser.getColumns(req.banaPool, schema, req.params.name);
    res.json({ columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/table/:name', resolveProject, async (req, res) => {
  try {
    const { schema = 'public', page = 1, pageSize = 50, sortBy, sortDir, filters } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const data = await dbBrowser.getTableData(req.banaPool, {
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

router.post('/projects/:id/query', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const { sql, confirm } = req.body;
    if (!sql) return res.status(400).json({ error: 'SQL is required' });
    const result = await dbBrowser.executeQuery(req.banaPool, sql, [], confirm);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/table/:name/row', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const row = await dbBrowser.insertRow(req.banaPool, schema, req.params.name, req.body);
    res.status(201).json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/projects/:id/table/:name/row/:rowId', resolveProject, enforceStorageLimit, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const primaryKey = req.query.primaryKey || 'id';
    const row = await dbBrowser.updateRow(req.banaPool, schema, req.params.name, primaryKey, req.params.rowId, req.body);
    res.json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/table/:name/row/:rowId', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const primaryKey = req.query.primaryKey || 'id';
    const result = await dbBrowser.deleteRow(req.banaPool, schema, req.params.name, primaryKey, req.params.rowId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auth User Management ──────────────────────────────────

router.get('/projects/:id/auth/users', resolveProject, async (req, res) => {
  try {
    const users = await banadbService.getAuthUsers(req.banaPool);
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
    const user = await banadbService.createAuthUser(req.banaPool, { email, password });
    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/projects/:id/auth/users/:userId', resolveProject, async (req, res) => {
  try {
    const user = await banadbService.toggleAuthUser(req.banaPool, req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/auth/users/:userId', resolveProject, async (req, res) => {
  try {
    const result = await banadbService.deleteAuthUser(req.banaPool, req.params.userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Keys ──────────────────────────────────────────────

router.get('/projects/:id/api-keys', async (req, res) => {
  try {
    // Auto-create default anon + service keys if missing
    const keys = await banadbService.ensureDefaultKeys(req.app.locals.pool, req.params.id);
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys', async (req, res) => {
  try {
    const { name, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Key name is required' });
    const result = await banadbService.createApiKey(req.app.locals.pool, req.params.id, { name, role });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/api-keys/regenerate', async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['anon', 'service'].includes(role)) {
      return res.status(400).json({ error: 'Role must be anon or service' });
    }
    const result = await banadbService.regenerateApiKey(req.app.locals.pool, req.params.id, role);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/projects/:id/api-keys/:keyId', async (req, res) => {
  try {
    const result = await banadbService.revokeApiKey(req.app.locals.pool, req.params.keyId);
    res.json(result);
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
      req.banaProject,
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
      req.banaProject
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
       FROM bana_projects WHERE id = $1`,
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

module.exports = router;
