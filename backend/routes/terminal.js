const express = require('express');
const terminalService = require('../services/terminalService');

const router = express.Router();

// Dynamic command prefixes that accept arguments
const DYNAMIC_PREFIXES = ['vpc db ', 'vpc db query ', 'vpc ai '];

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
    const { command, cwd } = req.body;

    if (!command) return res.status(400).json({ error: 'Command is required' });

    const trimmed = command.trim();

    // Built-in vpc commands (allowlist or dynamic prefix) → routed handler
    const { rows } = await pool.query(
      'SELECT * FROM allowed_commands WHERE command = $1 AND is_active = true',
      [trimmed]
    );
    const isDynamic = DYNAMIC_PREFIXES.some((prefix) => trimmed.startsWith(prefix));

    if (rows.length > 0 || isDynamic) {
      const result = await terminalService.execute(trimmed, pool);
      return res.json(result);
    }

    // Fallback: execute as a real shell command
    const result = await terminalService.shellExec(trimmed, cwd);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/terminal/resolve-cwd  → validate + resolve a target dir for `cd`
router.post('/resolve-cwd', async (req, res) => {
  try {
    const { cwd, target } = req.body;
    const result = await terminalService.resolveCwd(cwd, target);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
