const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const webHostingService = require('../services/webHostingService');

const router = express.Router();

// File extensions that are clearly static assets
const STATIC_EXTENSIONS = new Set([
  '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.map', '.json', '.xml', '.txt', '.webmanifest', '.manifest',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.pdf', '.zip', '.gz', '.br',
]);

// Middleware to serve hosted websites publicly
router.use(async (req, res, next) => {
  const pool = req.app.locals.pool;

  // Bug #8: Capture query string from the original URL so it's not lost
  const parsedUrl = url.parse(req.originalUrl);
  const queryString = parsedUrl.query || '';

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
        if (domainProject.project_type === 'fullstack') {
          // Bug #9: Smart routing for fullstack — try static first, then SPA fallback, then proxy
          return serveFullstack(req, res, next, domainProject, subPath, queryString);
        }
        const proxyPath = appendQuery(subPath, queryString);
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
    if (project.project_type === 'fullstack') {
      // Bug #9: Smart routing for fullstack — try static first, then SPA fallback, then proxy
      return serveFullstack(req, res, next, project, subPath, queryString);
    }

    // Pure node project — proxy everything
    const proxyPath = appendQuery(subPath, queryString);
    return proxyRequest(req, res, project.node_port, proxyPath);
  }

  // Static project — serve files
  serveStatic(project, subPath, res, next);
});

// Bug #8: Helper to append query string to a path
function appendQuery(targetPath, queryString) {
  if (!queryString) return targetPath;
  return targetPath + '?' + queryString;
}

// Bug #9: Smart fullstack routing
// 1. If the file exists on disk as a real static asset, serve it
// 2. If no file on disk and path has no extension (or is .html), serve index.html (SPA fallback)
// 3. Otherwise proxy to the Node backend
function serveFullstack(req, res, next, project, subPath, queryString) {
  const deployPath = project.deploy_path;
  if (!deployPath) return next();

  const baseDir = project.output_dir
    ? path.join(deployPath, project.output_dir)
    : deployPath;

  if (!fs.existsSync(baseDir)) {
    // No static dir — proxy everything to backend
    const proxyPath = appendQuery(subPath, queryString);
    return proxyRequest(req, res, project.node_port, proxyPath);
  }

  // Security: resolve real base path
  let realBase;
  try {
    realBase = fs.realpathSync(baseDir);
  } catch {
    const proxyPath = appendQuery(subPath, queryString);
    return proxyRequest(req, res, project.node_port, proxyPath);
  }

  // Check if a real static file exists at this path
  let filePath = path.join(baseDir, subPath);
  const ext = path.extname(subPath).toLowerCase();

  try {
    if (fs.existsSync(filePath)) {
      const realFile = fs.realpathSync(filePath);
      if (!realFile.startsWith(realBase)) {
        return res.status(403).send('Forbidden');
      }

      if (fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
      }
    }
  } catch {}

  // No file found on disk
  if (STATIC_EXTENSIONS.has(ext)) {
    // Looks like a static asset request (e.g. /assets/logo.png) but file not found — proxy to backend
    const proxyPath = appendQuery(subPath, queryString);
    return proxyRequest(req, res, project.node_port, proxyPath);
  }

  // No extension or .html — try SPA fallback (index.html)
  if (!ext || ext === '.html') {
    const indexPath = path.join(baseDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }

  // Fallback: proxy to backend
  const proxyPath = appendQuery(subPath, queryString);
  return proxyRequest(req, res, project.node_port, proxyPath);
}

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
