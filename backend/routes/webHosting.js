const express = require('express');
const webHostingService = require('../services/webHostingService');

const router = express.Router();

// GET /projects — list all
router.get('/projects', async (req, res) => {
  try {
    const projects = await webHostingService.listProjects(req.app.locals.pool);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects — create
router.post('/projects', async (req, res) => {
  try {
    const { name, slug, projectType, gitUrl, gitToken, gitBranch, buildCommand, installCommand, outputDir, nodeEntryPoint, envVars } = req.body;

    if (!name || !slug) return res.status(400).json({ error: 'Name and slug are required' });

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100);
    if (!cleanSlug) return res.status(400).json({ error: 'Invalid slug' });

    const project = await webHostingService.createProject(req.app.locals.pool, {
      name, slug: cleanSlug, projectType, gitUrl, gitToken, gitBranch,
      buildCommand, installCommand, outputDir, nodeEntryPoint, envVars,
      createdBy: req.admin.id,
    });

    res.status(201).json(project);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A project with this slug already exists' });
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id
router.get('/projects/:id', async (req, res) => {
  try {
    const project = await webHostingService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /projects/:id — update
router.put('/projects/:id', async (req, res) => {
  try {
    const project = await webHostingService.updateProject(req.app.locals.pool, req.params.id, req.body);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /projects/:id
router.delete('/projects/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await webHostingService.deleteProject(pool, req.params.id);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/deploy
router.post('/projects/:id/deploy', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.git_url) return res.status(400).json({ error: 'No git URL configured' });

    const result = await webHostingService.deploy(pool, project);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/redeploy
router.post('/projects/:id/redeploy', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await webHostingService.redeploy(pool, req.params.id);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/start
router.post('/projects/:id/start', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await webHostingService.startBackend(pool, project);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json({ message: 'Started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/stop
router.post('/projects/:id/stop', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await webHostingService.stopBackend(pool, project);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json({ message: 'Stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/restart
router.post('/projects/:id/restart', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await webHostingService.restartBackend(pool, project);
    res.json({ message: 'Restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/logs
router.get('/projects/:id/logs', async (req, res) => {
  try {
    const project = await webHostingService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const logs = await webHostingService.getLogs(project, parseInt(req.query.lines) || 100);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/status
router.get('/projects/:id/status', async (req, res) => {
  try {
    const project = await webHostingService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const status = await webHostingService.getStatus(project);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/domain/verify-token — generate verification token
router.post('/projects/:id/domain/verify-token', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.custom_domain) return res.status(400).json({ error: 'No custom domain configured. Save a domain first.' });
    const updated = await webHostingService.generateDomainVerifyToken(pool, req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/domain/verify — check DNS TXT record
router.post('/projects/:id/domain/verify', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const updated = await webHostingService.verifyDomain(pool, req.params.id);
    webHostingService.refreshDomainCache(pool);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /projects/:id/domain — remove custom domain
router.delete('/projects/:id/domain', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const updated = await webHostingService.removeDomain(pool, req.params.id);
    webHostingService.refreshDomainCache(pool);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
