const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./db/pool');
const { authenticateAdmin } = require('./middleware/auth');
const actionLogger = require('./middleware/actionLogger');
const ipRestriction = require('./middleware/ipRestriction');
const { globalLimiter, banaApiLimiter } = require('./middleware/rateLimiter');

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
  process.env.FRONTEND_URL,
].filter(Boolean);

// CORS for admin panel (restricted origins)
app.use('/api/admin', cors({ origin: allowedOrigins, credentials: true }));
// CORS for BanaDB external API (open to any origin)
app.use('/api/bana', cors());
// Fallback CORS
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach database pool
app.locals.pool = pool;

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// BanaDB External REST API (API key auth, no JWT)
app.use('/api/bana/v1', banaApiLimiter, require('./routes/banaApi'));

// Admin API routes
const adminRouter = express.Router();

// Auth routes (public - no JWT required)
adminRouter.use('/auth', require('./routes/auth'));

// All routes below require JWT authentication
adminRouter.use(authenticateAdmin);
adminRouter.use(ipRestriction);
adminRouter.use(actionLogger);

// Mount route files
adminRouter.use('/servers', require('./routes/servers'));
adminRouter.use('/db', require('./routes/database'));
adminRouter.use('/api-keys', require('./routes/apiKeys'));
adminRouter.use('/integrations', require('./routes/integrations'));
adminRouter.use('/backup', require('./routes/backups'));
adminRouter.use('/logs', require('./routes/logs'));
adminRouter.use('/terminal', require('./routes/terminal'));
adminRouter.use('/bana', require('./routes/banadb'));

// Placeholder authenticated route for testing
adminRouter.get('/me', (req, res) => {
  res.json({ admin: req.admin });
});

app.use('/api/admin', globalLimiter, adminRouter);

// Error handling
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
