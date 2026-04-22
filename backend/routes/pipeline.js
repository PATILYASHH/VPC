const express = require('express');
const router = express.Router();
const pipelineService = require('../services/pipelineService');

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
}

// List all pipelines
router.get('/pipelines', async (req, res) => {
  try {
    const pipelines = await pipelineService.getAll(req.app.locals.pool);
    res.json({ pipelines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create pipeline
router.post('/pipelines', async (req, res) => {
  try {
    const { name, slug, description, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const pipeline = await pipelineService.create(req.app.locals.pool, {
      name,
      slug: slug || slugify(name),
      description,
      color,
      createdBy: req.admin?.id,
    });
    res.status(201).json({ pipeline });
  } catch (err) {
    if (err.message?.includes('duplicate key')) {
      return res.status(409).json({ error: 'A pipeline with this slug already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get resolved pipeline (with all resource data grouped by environment)
router.get('/pipelines/:id', async (req, res) => {
  try {
    const result = await pipelineService.getResolved(req.app.locals.pool, req.params.id);
    if (!result) return res.status(404).json({ error: 'Pipeline not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update pipeline
router.put('/pipelines/:id', async (req, res) => {
  try {
    const { name, description, color } = req.body;
    const pipeline = await pipelineService.update(req.app.locals.pool, req.params.id, {
      name, description, color,
    });
    if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
    res.json({ pipeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete pipeline
router.delete('/pipelines/:id', async (req, res) => {
  try {
    await pipelineService.remove(req.app.locals.pool, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a single resource to pipeline
router.post('/pipelines/:id/resources', async (req, res) => {
  try {
    const { resourceType, resourceId, environment, displayOrder } = req.body;
    if (!resourceType || !resourceId) return res.status(400).json({ error: 'resourceType and resourceId required' });

    const resource = await pipelineService.addResource(req.app.locals.pool, req.params.id, {
      resourceType, resourceId, environment, displayOrder,
    });
    res.status(201).json({ resource });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a resource from pipeline
router.delete('/pipelines/:id/resources', async (req, res) => {
  try {
    const { resourceType, resourceId } = req.body;
    if (!resourceType || !resourceId) return res.status(400).json({ error: 'resourceType and resourceId required' });

    await pipelineService.removeResource(req.app.locals.pool, req.params.id, resourceType, resourceId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk set resources for a pipeline
router.put('/pipelines/:id/resources', async (req, res) => {
  try {
    const { resources } = req.body;
    if (!Array.isArray(resources)) return res.status(400).json({ error: 'resources must be an array' });

    await pipelineService.setResources(req.app.locals.pool, req.params.id, resources);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fork production resources to create beta environment
// body: { copyData?: bool, autoDeploy?: bool }
router.post('/pipelines/:id/fork-to-beta', async (req, res) => {
  try {
    const results = await pipelineService.forkToBeta(req.app.locals.pool, req.params.id, {
      copyData: req.body?.copyData !== false, // default true — exact fork
      autoDeploy: req.body?.autoDeploy !== false,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all available resources for linking
router.get('/available-resources', async (req, res) => {
  try {
    const resources = await pipelineService.getAvailableResources(req.app.locals.pool);
    res.json(resources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promote beta → production (schema PR + redeploy prod) — legacy
router.post('/pipelines/:id/promote-legacy', async (req, res) => {
  try {
    const result = await pipelineService.promoteToProd(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Perfect 1-click promote flow ────────────────────────────
const promoteService = require('../services/pipelinePromoteService');

// Preflight — returns the full plan, makes no changes
router.get('/pipelines/:id/promote/preflight', async (req, res) => {
  try {
    const plan = await promoteService.preflight(req.app.locals.pool, req.params.id);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute — applies schema + redeploys prod after confirmations
// body: { confirmations: { schema: true, deploy: true }, skipBackup?: bool, dryRun?: bool }
router.post('/pipelines/:id/promote', async (req, res) => {
  try {
    const result = await promoteService.promote(req.app.locals.pool, req.params.id, {
      initiatedBy: req.admin?.id,
      confirmations: req.body?.confirmations || {},
      skipBackup: req.body?.skipBackup,
      dryRun: req.body?.dryRun,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promotion history
router.get('/pipelines/:id/promotions', async (req, res) => {
  try {
    const runs = await promoteService.listRuns(req.app.locals.pool, req.params.id);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rollback a prior promotion (restores pre-promote DB snapshot)
router.post('/pipelines/:id/promotions/:runId/rollback', async (req, res) => {
  try {
    const result = await promoteService.rollback(req.app.locals.pool, req.params.runId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deploy a hosting resource from pipeline
router.post('/pipelines/:id/deploy/:hostingId', async (req, res) => {
  try {
    const result = await pipelineService.deployHosting(
      req.app.locals.pool, req.params.id, req.params.hostingId, req.body.environment || 'production'
    );
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pipeline activity feed
router.get('/pipelines/:id/activity', async (req, res) => {
  try {
    const activity = await pipelineService.getActivity(req.app.locals.pool, req.params.id, parseInt(req.query.limit) || 30);
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update pipeline settings
router.put('/pipelines/:id/settings', async (req, res) => {
  try {
    const pipeline = await pipelineService.update(req.app.locals.pool, req.params.id, { settings: req.body.settings });
    res.json({ pipeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
