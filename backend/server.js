require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./db/pool');
const { authenticateAdmin, checkPermission } = require('./middleware/auth');
const actionLogger = require('./middleware/actionLogger');
const ipRestriction = require('./middleware/ipRestriction');
// Rate limiters removed — private system, no throttling needed

const app = express();

// Security headers (relaxed for HTTP; tighten when SSL is added)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));

// CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://148.230.66.133:8001',
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS for admin panel (restricted origins)
app.use('/api/admin', cors({ origin: allowedOrigins, credentials: true }));
// CORS for DB external API (open to any origin)
app.use('/api/db', cors());
// Fallback CORS
app.use(cors({ origin: allowedOrigins, credentials: true }));

// PR preview webhook — must come BEFORE global json parser so we can capture
// the raw body for HMAC verification (the webhook router mounts its own json
// parser with a verify callback).
app.use('/api/webhooks/github', require('./routes/webHostingWebhook'));

// Body parsing — skip /vcs and /api/webhooks routes (they handle their own parsing)
app.use((req, res, next) => {
  if (req.path.startsWith('/vcs/') || req.path.startsWith('/api/webhooks/')) return next();
  express.json({ limit: '500mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path.startsWith('/vcs/') || req.path.startsWith('/api/webhooks/')) return next();
  express.urlencoded({ extended: true, limit: '500mb' })(req, res, next);
});

// Attach database pool + central logger + capture boot commit
app.locals.pool = pool;
require('./utils/logger').setPool(pool);
require('./services/upgradeService').captureBoot();

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// DB Public OAuth flow (browser-facing, no apikey — verified via signed state token)
app.use('/api/db/auth/v1', require('./routes/dbAuthOAuth'));

// DB External REST API (API key auth, no JWT)
app.use('/api/db/v1', require('./routes/dbApi'));
// Legacy alias so existing hosted apps using /api/bana/v1 keep working
app.use('/api/bana/v1', require('./routes/dbApi'));
// DB Pull API (pull key auth, no JWT)
app.use('/api/db/v1', require('./routes/pull'));
app.use('/api/bana/v1', require('./routes/pull'));
app.use('/api/db/v1', require('./routes/syncApi'));
app.use('/api/bana/v1', require('./routes/syncApi'));

// Admin API routes
const adminRouter = express.Router();

// Auth routes (public - no JWT required)
adminRouter.use('/auth', require('./routes/auth'));

// Device-flow auth (mixed: /code + /token public, /pending + /confirm JWT-authed internally)
adminRouter.use('/auth/device', require('./routes/deviceAuth'));

// All routes below require JWT authentication
adminRouter.use(authenticateAdmin);
adminRouter.use(ipRestriction);
adminRouter.use(checkPermission);
adminRouter.use(actionLogger);

// Mount route files
adminRouter.use('/servers', require('./routes/servers'));
adminRouter.use('/db', require('./routes/database'));
adminRouter.use('/db', require('./routes/db'));
adminRouter.use('/api-keys', require('./routes/apiKeys'));
adminRouter.use('/integrations', require('./routes/integrations'));
adminRouter.use('/backup', require('./routes/backups'));
adminRouter.use('/logs', require('./routes/logs'));
adminRouter.use('/terminal', require('./routes/terminal'));
adminRouter.use('/users', require('./routes/users'));
adminRouter.use('/gallery', require('./routes/gallery'));
adminRouter.use('/sync', require('./routes/sync'));
adminRouter.use('/web-hosting', require('./routes/webHosting'));
adminRouter.use('/settings', require('./routes/settings'));
adminRouter.use('/vpshub', require('./routes/vpshub'));
adminRouter.use('/pipeline', require('./routes/pipeline'));
adminRouter.use('/realtime', require('./routes/realtime'));
adminRouter.use('/upgrade', require('./routes/upgrade'));

// Return current admin info including permissions
adminRouter.get('/me', (req, res) => {
  res.json({ admin: req.admin });
});

app.use('/api/admin', adminRouter);

// VPC VCS Transfer Protocol (no JWT, uses Basic Auth with PAT tokens)
// Must come BEFORE static files and SPA fallback
app.use('/vcs', require('./routes/vpshubVcs'));

// Web hosting: serve hosted projects by slug or custom domain
// Must come BEFORE the SPA catch-all so /koperp/ etc. are handled correctly
const webHostingPublic = require('./routes/webHostingPublic');
const webHostingService = require('./services/webHostingService');
app.use(webHostingPublic);

// Device-flow approval page (VS Code sign-in) — served standalone, reuses SPA's vpc-token
app.get('/auth/device', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'deviceApprove.html'));
});

// Serve downloadable files (VS Code extension, etc.)
app.use('/downloads', express.static(path.join(__dirname, '..', 'downloads')));

// Serve frontend static files
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Error handling
app.use((err, req, res, _next) => {
  // Surface "needs integration" errors with a structured payload the frontend recognises
  if (err && err.code === 'INTEGRATION_MISSING') {
    return res.status(412).json({
      error: err.message,
      code: 'INTEGRATION_MISSING',
      integrationType: err.integrationType,
    });
  }
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
