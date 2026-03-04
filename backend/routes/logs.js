const express = require('express');
const logService = require('../services/logService');

const router = express.Router();

// GET /api/admin/logs?source=all&search=&page=1&pageSize=100
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { source = 'action_log', search, page = 1, pageSize = 100 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);

    if (source === 'action_log' || source === 'all') {
      let where = '';
      const params = [];
      let paramIndex = 1;

      if (search) {
        where = `WHERE action ILIKE $${paramIndex} OR admin_username ILIKE $${paramIndex} OR entity_type ILIKE $${paramIndex}`;
        params.push(`%${search}%`);
        paramIndex++;
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM action_logs ${where}`,
        params
      );

      const { rows } = await pool.query(
        `SELECT * FROM action_logs ${where} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, parseInt(pageSize), offset]
      );

      return res.json({
        logs: rows,
        total: parseInt(countResult.rows[0].count),
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        source: 'action_log',
      });
    }

    // File-based logs
    const logPaths = {
      erp: process.env.LOG_PATH_ERP,
      nginx: process.env.LOG_PATH_NGINX_ACCESS,
      nginx_error: process.env.LOG_PATH_NGINX_ERROR,
    };

    const logPath = logPaths[source];
    if (!logPath) {
      return res.status(400).json({ error: `Unknown log source: ${source}` });
    }

    const result = await logService.readLogFile(logPath, { search, lines: parseInt(pageSize) });
    res.json({
      logs: result.lines.map((line, i) => ({ id: `${source}-${i}`, message: line, source })),
      total: result.total,
      source,
      error: result.error,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
