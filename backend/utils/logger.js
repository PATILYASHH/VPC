/**
 * Central logger — writes to console AND vpc_system_logs when a pool is
 * available. Usage:
 *   const log = require('../utils/logger').forSource('pipeline');
 *   log.error('promote failed', { pipelineId, err: err.message });
 */

let globalPool = null;
let queueBeforePool = [];

function setPool(pool) {
  globalPool = pool;
  // Flush anything queued before pool was attached
  const pending = queueBeforePool.slice();
  queueBeforePool = [];
  for (const row of pending) {
    persist(row).catch(() => {});
  }
}

async function persist({ level, source, message, metadata }) {
  const row = { level, source, message, metadata };
  if (!globalPool) { queueBeforePool.push(row); return; }
  try {
    await globalPool.query(
      `INSERT INTO vpc_system_logs (level, source, message, metadata) VALUES ($1, $2, $3, $4)`,
      [level, source, message.slice(0, 8000), metadata ? JSON.stringify(metadata) : null]
    );
  } catch { /* swallow — never fail on logging */ }
}

function _emit(level, source, msg, metadata) {
  const consoleFn = level === 'error' || level === 'fatal' ? console.error
    : level === 'warn' ? console.warn
    : console.log;
  consoleFn(`[${source}:${level}]`, msg, metadata || '');
  persist({ level, source, message: String(msg), metadata });
}

function forSource(source) {
  return {
    debug: (m, meta) => _emit('debug', source, m, meta),
    info: (m, meta) => _emit('info', source, m, meta),
    warn: (m, meta) => _emit('warn', source, m, meta),
    error: (m, meta) => _emit('error', source, m, meta),
    fatal: (m, meta) => _emit('fatal', source, m, meta),
  };
}

// Health summary: error counts in last 24h, bucketed by source
async function healthSummary(pool) {
  if (!pool) pool = globalPool;
  if (!pool) return { errors_24h: 0, sources: [], recent: [] };
  try {
    const { rows: totals } = await pool.query(
      `SELECT source, level, COUNT(*)::int AS count
       FROM vpc_system_logs
       WHERE created_at > NOW() - INTERVAL '24 hours'
       GROUP BY source, level`
    );
    const { rows: recent } = await pool.query(
      `SELECT id, level, source, message, created_at
       FROM vpc_system_logs
       WHERE level IN ('warn','error','fatal') AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC LIMIT 20`
    );
    const bySource = {};
    let errors24 = 0;
    for (const t of totals) {
      bySource[t.source] = bySource[t.source] || { info: 0, warn: 0, error: 0 };
      bySource[t.source][t.level] = t.count;
      if (t.level === 'error' || t.level === 'fatal') errors24 += t.count;
    }
    return { errors_24h: errors24, sources: bySource, recent };
  } catch (err) {
    return { errors_24h: 0, sources: {}, recent: [], error: err.message };
  }
}

module.exports = { setPool, forSource, healthSummary };
