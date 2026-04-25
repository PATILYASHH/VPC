const express = require('express');
const path = require('path');
const fs = require('fs');
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

// POST /projects/:id/fix-with-ai — use AI to fix build errors and redeploy
router.post('/projects/:id/fix-with-ai', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const result = await webHostingService.fixWithAI(pool, req.params.id);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/smart-deploy — zero-config deploy with auto-fix loop
// Auto-detects project type, installs deps, builds, starts, and fixes errors automatically
router.post('/projects/:id/smart-deploy', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deployPath = project.deploy_path || path.join(webHostingService.HOSTING_DIR, project.slug);
    const maxRetries = 3;
    let attempt = 0;
    let lastError = null;
    const log = [];

    // Step 1: Auto-detect project structure if build commands are not set
    if (!project.build_command && !project.install_command) {
      try {
        const detected = webHostingService.detectProjectStructure(deployPath, project.slug);
        if (detected) {
          await pool.query(
            `UPDATE web_hosting_projects SET
              project_type = COALESCE($1, project_type),
              install_command = COALESCE($2, install_command),
              build_command = COALESCE($3, build_command),
              output_dir = COALESCE($4, output_dir),
              node_entry_point = COALESCE($5, node_entry_point),
              updated_at = NOW()
            WHERE id = $6`,
            [detected.projectType, detected.installCommand, detected.buildCommand, detected.outputDir, detected.nodeEntryPoint, project.id]
          );
          log.push(`Auto-detected: ${detected.projectType} (${detected.framework || 'generic'})`);
        }
      } catch (detectErr) {
        log.push(`Detection warning: ${detectErr.message}`);
      }
    }

    // Step 2: Deploy with auto-fix retry loop
    while (attempt < maxRetries) {
      attempt++;
      log.push(`--- Deploy attempt ${attempt}/${maxRetries} ---`);

      try {
        const result = await webHostingService.deploy(pool, project);
        webHostingService.refreshSlugCache(pool);
        webHostingService.refreshDomainCache(pool);
        log.push('Deploy succeeded');
        return res.json({ success: true, attempts: attempt, log, result });
      } catch (deployErr) {
        lastError = deployErr.message;
        log.push(`Error: ${deployErr.message}`);

        // If we have retries left, try AI fix
        if (attempt < maxRetries) {
          log.push('Attempting AI auto-fix...');
          try {
            const fixResult = await webHostingService.fixWithAI(pool, project.id);
            log.push(`AI fix applied: ${fixResult.fixesApplied || 0} fix(es)`);
            // Reload project in case fixWithAI updated configs
            const updated = await webHostingService.getProject(pool, project.id);
            if (updated) Object.assign(project, updated);
          } catch (fixErr) {
            log.push(`AI fix failed: ${fixErr.message}`);
            break; // Stop retrying if AI can't help
          }
        }
      }
    }

    res.json({
      success: false,
      attempts: attempt,
      error: lastError,
      log,
      message: `Deploy failed after ${attempt} attempt(s). Check the log for details.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/scan — auto-detect project structure (Bug #10)
router.post('/projects/:id/scan', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.git_url) return res.status(400).json({ error: 'No git URL configured' });

    const deployPath = project.deploy_path || path.join(webHostingService.HOSTING_DIR, project.slug);
    webHostingService.ensureHostingDir();

    // Shallow clone if not already cloned
    if (!fs.existsSync(path.join(deployPath, '.git'))) {
      if (fs.existsSync(deployPath)) {
        fs.rmSync(deployPath, { recursive: true, force: true });
      }
      const cloneUrl = webHostingService.buildCloneUrl(project.git_url, project.git_token);
      const branch = project.git_branch || 'main';
      const { execFileSync } = require('child_process');
      execFileSync('git', ['clone', '--depth', '1', '-b', branch, cloneUrl, deployPath], {
        cwd: webHostingService.HOSTING_DIR,
        timeout: 60000,
        stdio: 'pipe',
      });
    }

    const detected = webHostingService.detectProjectStructure(deployPath, project.slug);
    res.json({ detected });
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

// GET /projects/:id/git-status — check if remote has newer commits than deployed
router.get('/projects/:id/git-status', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deployPath = project.deploy_path || path.join(webHostingService.HOSTING_DIR, project.slug);
    const result = { hasUpdates: false, localCommit: null, remoteCommit: null, behind: 0, branch: project.git_branch || 'main' };

    if (!fs.existsSync(path.join(deployPath, '.git'))) {
      return res.json({ ...result, error: 'Not deployed yet' });
    }

    const { execFileSync } = require('child_process');
    const opts = { cwd: deployPath, encoding: 'utf8', timeout: 15000 };

    try {
      // Get local HEAD
      result.localCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
      result.localMessage = execFileSync('git', ['log', '-1', '--format=%s'], opts).trim();
      result.localDate = execFileSync('git', ['log', '-1', '--format=%ci'], opts).trim();

      // Fetch remote
      execFileSync('git', ['fetch', 'origin', '--quiet'], { ...opts, timeout: 10000 });

      // Get remote HEAD
      const branch = project.git_branch || 'main';
      result.remoteCommit = execFileSync('git', ['rev-parse', '--short', `origin/${branch}`], opts).trim();
      result.remoteMessage = execFileSync('git', ['log', '-1', '--format=%s', `origin/${branch}`], opts).trim();
      result.remoteDate = execFileSync('git', ['log', '-1', '--format=%ci', `origin/${branch}`], opts).trim();

      // Count commits behind
      const behindStr = execFileSync('git', ['rev-list', `HEAD..origin/${branch}`, '--count'], opts).trim();
      result.behind = parseInt(behindStr) || 0;
      result.hasUpdates = result.behind > 0;
    } catch (gitErr) {
      result.error = gitErr.message;
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/versions — list rollback-available versions (last 3)
router.get('/projects/:id/versions', async (req, res) => {
  try {
    const versions = await webHostingService.listVersions(req.app.locals.pool, req.params.id);
    res.json({ versions, max: webHostingService.MAX_VERSIONS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/rollback/:versionId — instantly restore an archived version
router.post('/projects/:id/rollback/:versionId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await webHostingService.rollback(pool, req.params.id, req.params.versionId);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PR Previews ───────────────────────────────────────────────

const previewService = require('../services/webHostingPreviewService');

function getPublicHost(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const hostHeader = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${hostHeader}`;
}

// GET /projects/:id/preview-settings — webhook URL + secret + enabled flag
router.get('/projects/:id/preview-settings', async (req, res) => {
  try {
    const settings = await previewService.getSettings(req.app.locals.pool, req.params.id);
    res.json({
      enabled: settings.enabled,
      secret: settings.secret,
      webhook_url: `${getPublicHost(req)}/api/webhooks/github/wh/${req.params.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /projects/:id/preview-settings — toggle previews on/off, optionally regenerate secret
router.put('/projects/:id/preview-settings', async (req, res) => {
  try {
    const { enabled, regenerateSecret } = req.body;
    const result = await previewService.setEnabled(
      req.app.locals.pool, req.params.id, enabled, !!regenerateSecret
    );
    res.json({
      enabled: result.enabled,
      secret: result.secret,
      webhook_url: `${getPublicHost(req)}/api/webhooks/github/wh/${req.params.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/previews — list all open previews
router.get('/projects/:id/previews', async (req, res) => {
  try {
    const previews = await previewService.listPreviews(req.app.locals.pool, req.params.id);
    res.json({ previews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /projects/:id/previews/:previewId/rebuild — manually rebuild a preview
router.post('/projects/:id/previews/:previewId/rebuild', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const project = await webHostingService.getProject(pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Build asynchronously so the request returns quickly
    previewService.rebuildPreview(pool, project, req.params.previewId, getPublicHost(req))
      .catch((err) => console.error('[preview rebuild] failed:', err.message));
    res.json({ ok: true, message: 'Rebuild started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /projects/:id/previews/:previewId — manually close a preview
router.delete('/projects/:id/previews/:previewId', async (req, res) => {
  try {
    await previewService.closePreview(req.app.locals.pool, req.params.previewId);
    webHostingService.refreshSlugCache(req.app.locals.pool);
    res.json({ closed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /projects/:id/auto-deploy — toggle auto-deploy on git push
router.put('/projects/:id/auto-deploy', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { enabled } = req.body;
    await pool.query(
      `INSERT INTO vpc_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [`wh_auto_deploy_${req.params.id}`, JSON.stringify({ enabled: !!enabled })]
    );
    res.json({ enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /projects/:id/auto-deploy — get auto-deploy status
router.get('/projects/:id/auto-deploy', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query('SELECT value FROM vpc_settings WHERE key = $1', [`wh_auto_deploy_${req.params.id}`]);
    const val = rows[0]?.value ? JSON.parse(rows[0].value) : { enabled: false };
    res.json(val);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
