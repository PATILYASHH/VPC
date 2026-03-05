const express = require('express');
const router = express.Router();
const banadbService = require('../services/banadbService');
const dbBrowser = require('../services/dbBrowserService');

// ─── Projects ──────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  try {
    const projects = await banadbService.getProjects(req.app.locals.pool);
    res.json({ projects });
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

router.post('/projects/:id/query', resolveProject, async (req, res) => {
  try {
    const { sql, confirm } = req.body;
    if (!sql) return res.status(400).json({ error: 'SQL is required' });
    const result = await dbBrowser.executeQuery(req.banaPool, sql, [], confirm);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/table/:name/row', resolveProject, async (req, res) => {
  try {
    const schema = req.query.schema || 'public';
    const row = await dbBrowser.insertRow(req.banaPool, schema, req.params.name, req.body);
    res.status(201).json({ row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/projects/:id/table/:name/row/:rowId', resolveProject, async (req, res) => {
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
    const keys = await banadbService.getApiKeys(req.app.locals.pool, req.params.id);
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

router.delete('/projects/:id/api-keys/:keyId', async (req, res) => {
  try {
    const result = await banadbService.revokeApiKey(req.app.locals.pool, req.params.keyId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
