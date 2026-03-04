function deriveAction(method, path) {
  const clean = path.replace(/^\//, '').replace(/\/[0-9a-f-]{36}/g, '/:id');
  const parts = clean.split('/').filter(Boolean);
  const prefix = parts[0] || 'unknown';
  const suffix = parts.slice(1).join('.');

  const methodMap = { GET: 'view', POST: 'create', PUT: 'update', DELETE: 'delete', PATCH: 'update' };
  const verb = methodMap[method] || method.toLowerCase();

  return suffix ? `${prefix}.${suffix}` : `${prefix}.${verb}`;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return {};
  const sanitized = { ...body };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'password_hash'];
  for (const key of sensitiveKeys) {
    if (sanitized[key]) sanitized[key] = '[REDACTED]';
  }
  return sanitized;
}

function actionLogger(req, res, next) {
  const startTime = Date.now();

  res.on('finish', async () => {
    try {
      const pool = req.app.locals.pool;
      if (!pool || !req.admin) return;

      const action = deriveAction(req.method, req.path);
      const details = sanitizeBody(req.body);

      await pool.query(
        `INSERT INTO action_logs
         (admin_id, admin_username, action, entity_type, entity_id,
          details, ip_address, user_agent, status, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          req.admin.id,
          req.admin.username,
          action,
          req.params.name || req.params.id ? (req.baseUrl.split('/').pop() || null) : null,
          req.params.id || req.params.name || null,
          JSON.stringify(details),
          req.ip,
          req.get('user-agent'),
          res.statusCode < 400 ? 'success' : 'error',
          Date.now() - startTime,
        ]
      );
    } catch (err) {
      console.error('[ActionLogger] Failed to log action:', err.message);
    }
  });

  next();
}

module.exports = actionLogger;
