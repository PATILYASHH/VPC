const express = require('express');
const router = express.Router();
const { banaApiAuth, banaStorageCheck } = require('../middleware/banaApiAuth');
const banadbService = require('../services/banadbService');
const dbBrowser = require('../services/dbBrowserService');
const { signToken, verifyToken } = require('../utils/jwt');
const { validateIdentifier, quoteIdentifier } = require('../utils/sanitize');

// All routes require API key
router.use(banaApiAuth);

// ─── Auth ──────────────────────────────────────────────────

router.post('/:slug/auth/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const user = await banadbService.createAuthUser(req.banaPool, { email, password });

    const token = signToken({
      sub: user.id,
      email: user.email,
      project: req.banaProject.id,
      type: 'bana_user',
    });

    res.status(201).json({ user, access_token: token });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:slug/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await banadbService.authenticateAuthUser(req.banaPool, email, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken({
      sub: user.id,
      email: user.email,
      project: req.banaProject.id,
      type: 'bana_user',
    });

    res.json({ user, access_token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REST API ──────────────────────────────────────────────

// Parse Supabase-style query filters: ?id=eq.5&name=ilike.*john*
function parseFilters(query, excludeKeys) {
  const filters = [];
  for (const [key, val] of Object.entries(query)) {
    if (excludeKeys.includes(key)) continue;
    const dotIdx = val.indexOf('.');
    if (dotIdx === -1) continue;
    const op = val.slice(0, dotIdx);
    const value = val.slice(dotIdx + 1);
    const opMap = { eq: 'eq', neq: 'neq', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', like: 'like', ilike: 'ilike', is: value === 'null' ? 'is_null' : undefined };
    if (opMap[op]) {
      filters.push({ column: key, operator: opMap[op], value: opMap[op] === 'is_null' ? null : value });
    }
  }
  return filters;
}

router.get('/:slug/rest/:table', async (req, res) => {
  try {
    const table = req.params.table;
    validateIdentifier(table);

    const { select, order, limit = '100', offset = '0' } = req.query;
    const filters = parseFilters(req.query, ['select', 'order', 'limit', 'offset']);

    const pageSize = Math.min(parseInt(limit) || 100, 1000);
    const pageOffset = parseInt(offset) || 0;

    const data = await dbBrowser.getTableData(req.banaPool, {
      schema: 'public',
      table,
      page: Math.floor(pageOffset / pageSize) + 1,
      pageSize,
      offset: pageOffset,
      sortBy: order?.replace(/^-/, '') || undefined,
      sortDir: order?.startsWith('-') ? 'desc' : 'asc',
      filters: JSON.stringify(filters),
    });

    res.json(data.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:slug/rest/:table', banaStorageCheck, async (req, res) => {
  try {
    const table = req.params.table;
    validateIdentifier(table);

    // Service key can write, anon key needs auth token
    if (req.banaKeyRole === 'anon') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Write operations require user authentication' });
      }
      try {
        const decoded = verifyToken(authHeader.slice(7));
        if (decoded.project !== req.banaProject.id) {
          return res.status(403).json({ error: 'Token does not match project' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    const row = await dbBrowser.insertRow(req.banaPool, 'public', table, req.body);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:slug/rest/:table', banaStorageCheck, async (req, res) => {
  try {
    const table = req.params.table;
    validateIdentifier(table);

    // Require auth for writes with anon key
    if (req.banaKeyRole === 'anon') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Write operations require user authentication' });
      }
      try {
        const decoded = verifyToken(authHeader.slice(7));
        if (decoded.project !== req.banaProject.id) {
          return res.status(403).json({ error: 'Token does not match project' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    const filters = parseFilters(req.query, ['select']);
    if (filters.length === 0) {
      return res.status(400).json({ error: 'Filter required for PATCH (e.g., ?id=eq.123)' });
    }

    // Find the primary key filter
    const pkFilter = filters[0];
    const row = await dbBrowser.updateRow(
      req.banaPool, 'public', table, pkFilter.column, pkFilter.value, req.body
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:slug/rest/:table', async (req, res) => {
  try {
    const table = req.params.table;
    validateIdentifier(table);

    if (req.banaKeyRole === 'anon') {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Delete operations require user authentication' });
      }
      try {
        const decoded = verifyToken(authHeader.slice(7));
        if (decoded.project !== req.banaProject.id) {
          return res.status(403).json({ error: 'Token does not match project' });
        }
      } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }

    const filters = parseFilters(req.query, []);
    if (filters.length === 0) {
      return res.status(400).json({ error: 'Filter required for DELETE (e.g., ?id=eq.123)' });
    }

    const pkFilter = filters[0];
    const result = await dbBrowser.deleteRow(
      req.banaPool, 'public', table, pkFilter.column, pkFilter.value
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SQL (service key only) ────────────────────────────────

router.post('/:slug/sql', banaStorageCheck, async (req, res) => {
  try {
    if (req.banaKeyRole !== 'service') {
      return res.status(403).json({ error: 'SQL execution requires a service key' });
    }

    const { sql } = req.body;
    if (!sql) return res.status(400).json({ error: 'SQL is required' });

    const result = await dbBrowser.executeQuery(req.banaPool, sql, [], true);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
