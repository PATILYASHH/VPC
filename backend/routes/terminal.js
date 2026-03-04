const express = require('express');
const terminalService = require('../services/terminalService');

const router = express.Router();

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

    // Exact-match validation against whitelist
    const { rows } = await pool.query(
      'SELECT * FROM allowed_commands WHERE command = $1 AND is_active = true',
      [command.trim()]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: `Command not allowed: "${command}"` });
    }

    const result = await terminalService.execute(command.trim(), pool);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
