const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const webHostingService = require('../services/webHostingService');

const router = express.Router();

// Middleware to serve hosted websites publicly
router.use(async (req, res, next) => {
  const pool = req.app.locals.pool;

  // 1. Custom domain routing — check Host header against registered domains
  const host = req.hostname; // hostname without port
  const isExternalDomain = host
    && !host.includes('localhost')
    && !/^\d+\.\d+\.\d+\.\d+$/.test(host); // not a raw IP

  if (isExternalDomain) {
    let domainProject = webHostingService.getDomainCache()[host];
    if (!domainProject) {
      try {
        domainProject = await webHostingService.getProjectByDomain(pool, host);
      } catch {}
    }

    if (domainProject && domainProject.status !== 'stopped') {
      const subPath = req.path || '/';
      if ((domainProject.project_type === 'node' || domainProject.project_type === 'fullstack') && domainProject.node_port) {
        if (domainProject.project_type === 'fullstack' && !subPath.startsWith('/api')) {
          return serveStatic(domainProject, subPath, res, next);
        }
        const proxyPath = domainProject.project_type === 'fullstack' ? subPath.replace(/^\/api/, '') || '/' : subPath;
        return proxyRequest(req, res, domainProject.node_port, proxyPath);
      }
      return serveStatic(domainProject, subPath, res, next);
    }
  }

  // 2. Slug-based routing (path prefix)
  const pathParts = req.path.split('/').filter(Boolean);
  if (pathParts.length === 0) return next();

  const slug = pathParts[0];

  // Skip known VPC routes
  const skipPaths = ['api', 'admin', 'storage', 'uploads', 'downloads', 'health', 'web-hosting'];
  if (skipPaths.includes(slug)) return next();

  // Check slug cache first, fall back to DB
  let project = webHostingService.getSlugCache()[slug];
  if (!project) {
    try {
      project = await webHostingService.getProjectBySlug(req.app.locals.pool, slug);
    } catch {
      return next();
    }
  }

  if (!project || project.status === 'stopped') return next();

  // Redirect /slug → /slug/ so relative asset paths (./assets/...) resolve correctly
  if (pathParts.length === 1 && !req.path.endsWith('/')) {
    return res.redirect(301, req.path + '/');
  }

  const subPath = '/' + pathParts.slice(1).join('/');

  // For node/fullstack projects, proxy to Node backend
  if ((project.project_type === 'node' || project.project_type === 'fullstack') && project.node_port) {
    // Fullstack: proxy /slug/api/* to Node, serve static for everything else
    if (project.project_type === 'fullstack' && !subPath.startsWith('/api')) {
      return serveStatic(project, subPath, res, next);
    }

    // Proxy to Node backend
    const proxyPath = project.project_type === 'fullstack' ? subPath.replace(/^\/api/, '') || '/' : subPath;
    return proxyRequest(req, res, project.node_port, proxyPath);
  }

  // Static project — serve files
  serveStatic(project, subPath, res, next);
});

function proxyRequest(req, res, port, targetPath) {
  const options = {
    hostname: '127.0.0.1',
    port,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.status(502).json({ error: 'Backend is not responding' });
  });

  if (req.body && Object.keys(req.body).length > 0) {
    proxyReq.write(JSON.stringify(req.body));
  }

  req.pipe(proxyReq);
}

function serveStatic(project, subPath, res, next) {
  const deployPath = project.deploy_path;
  if (!deployPath) return next();

  const baseDir = project.output_dir
    ? path.join(deployPath, project.output_dir)
    : deployPath;

  if (!fs.existsSync(baseDir)) return next();

  let filePath = path.join(baseDir, subPath);

  // Security: prevent path traversal
  let realBase;
  try {
    realBase = fs.realpathSync(baseDir);
  } catch {
    return next();
  }

  try {
    if (fs.existsSync(filePath)) {
      const realFile = fs.realpathSync(filePath);
      if (!realFile.startsWith(realBase)) return res.status(403).send('Forbidden');

      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    }
  } catch {
    // File doesn't exist, will be handled below
  }

  // If file exists, serve it
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }

  // SPA fallback: serve index.html for non-file routes
  const indexPath = path.join(baseDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }

  next();
}

module.exports = router;
