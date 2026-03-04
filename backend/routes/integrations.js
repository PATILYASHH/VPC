const express = require('express');

const router = express.Router();

// GET /api/admin/integrations
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const { rows } = await pool.query(`
      SELECT s.*,
        COALESCE(json_agg(
          json_build_object(
            'hour', h.hour_start,
            'requests', h.request_count,
            'errors', h.error_count,
            'avg_ms', h.avg_response_ms
          ) ORDER BY h.hour_start
        ) FILTER (WHERE h.id IS NOT NULL), '[]') AS hourly_stats
      FROM integration_stats s
      LEFT JOIN integration_stats_hourly h
        ON h.integration_id = s.id AND h.hour_start >= NOW() - INTERVAL '24 hours'
      GROUP BY s.id
      ORDER BY s.system_name
    `);

    res.json({ integrations: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
