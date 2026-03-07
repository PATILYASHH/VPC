const express = require('express');
const terminalService = require('../services/terminalService');

const router = express.Router();

// Dynamic command prefixes that accept arguments
const DYNAMIC_PREFIXES = ['vpc bana ', 'vpc db query '];

// GET /api/admin/terminal/commands
router.get('/commands', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      'SELECT * FROM allowed_commands WHERE is_active = true ORDER BY category, command'
    );
    res.json({ commands: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/terminal/execute
router.post('/execute', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { command } = req.body;

    if (!command) return res.status(400).json({ error: 'Command is required' });

    const trimmed = command.trim();

    // Check exact match first
    const { rows } = await pool.query(
      'SELECT * FROM allowed_commands WHERE command = $1 AND is_active = true',
      [trimmed]
    );

    // If no exact match, check if it matches a dynamic prefix
    if (rows.length === 0) {
      const isDynamic = DYNAMIC_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
      if (!isDynamic) {
        return res.status(403).json({ error: `Command not allowed: "${trimmed}"` });
      }
    }

    const result = await terminalService.execute(trimmed, pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
