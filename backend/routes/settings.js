const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Encryption for secret values (API keys etc.)
const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'vpc-default-key', 'vpc-settings-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

function decrypt(data) {
  try {
    const [ivHex, tagHex, encrypted] = data.split(':');
    const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(encrypted, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

// Mask secret values for display (show first 8 + last 4 chars)
function maskSecret(val) {
  if (!val || val.length < 16) return val ? '***' : '';
  return val.slice(0, 8) + '...' + val.slice(-4);
}

// Ensure vpc_settings table exists
async function ensureTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vpc_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      is_secret BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by VARCHAR(100)
    )
  `);
}

// ─── GET all settings ──────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    const { rows } = await pool.query('SELECT key, value, is_secret, updated_at, updated_by FROM vpc_settings ORDER BY key');

    const settings = {};
    for (const row of rows) {
      if (row.is_secret && row.value) {
        const decrypted = decrypt(row.value);
        settings[row.key] = {
          value: maskSecret(decrypted),
          is_set: !!decrypted,
          is_secret: true,
          updated_at: row.updated_at,
          updated_by: row.updated_by,
        };
      } else {
        settings[row.key] = {
          value: row.value,
          is_set: !!row.value,
          is_secret: false,
          updated_at: row.updated_at,
          updated_by: row.updated_by,
        };
      }
    }

    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET single setting ────────────────────────────────────

router.get('/:key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    const { rows } = await pool.query('SELECT key, value, is_secret, updated_at, updated_by FROM vpc_settings WHERE key = $1', [req.params.key]);
    if (rows.length === 0) return res.json({ value: null, is_set: false });

    const row = rows[0];
    if (row.is_secret && row.value) {
      const decrypted = decrypt(row.value);
      return res.json({ value: maskSecret(decrypted), is_set: !!decrypted, is_secret: true });
    }
    res.json({ value: row.value, is_set: !!row.value, is_secret: row.is_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT upsert setting ────────────────────────────────────

router.put('/:key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    const { value, is_secret } = req.body;
    const storeValue = is_secret && value ? encrypt(value) : (value || null);

    await pool.query(`
      INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by)
      VALUES ($1, $2, $3, NOW(), $4)
      ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = $3, updated_at = NOW(), updated_by = $4
    `, [req.params.key, storeValue, !!is_secret, req.admin?.username || 'system']);

    // If it's an API key for a known service, apply it to the runtime
    if (req.params.key === 'anthropic_api_key' && value) {
      process.env.ANTHROPIC_API_KEY = value;
    }

    res.json({ success: true, key: req.params.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE setting ────────────────────────────────────────

router.delete('/:key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    await pool.query('DELETE FROM vpc_settings WHERE key = $1', [req.params.key]);

    if (req.params.key === 'anthropic_api_key') {
      delete process.env.ANTHROPIC_API_KEY;
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET AI agent permissions ──────────────────────────────

router.get('/ai-agent/permissions', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'ai_agent_permissions'");
    const perms = rows[0]?.value ? JSON.parse(rows[0].value) : getDefaultPermissions();
    res.json({ permissions: perms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT AI agent permissions ──────────────────────────────

router.put('/ai-agent/permissions', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    const perms = req.body.permissions || {};
    await pool.query(`
      INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by)
      VALUES ('ai_agent_permissions', $1, FALSE, NOW(), $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2
    `, [JSON.stringify(perms), req.admin?.username || 'system']);

    res.json({ success: true, permissions: perms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST test API key connection ──────────────────────────

router.post('/ai-agent/test', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);

    // Get the API key (from runtime env or DB)
    let apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'anthropic_api_key'");
      if (rows[0]?.value) {
        apiKey = decrypt(rows[0].value);
      }
    }

    if (!apiKey) {
      return res.json({ success: false, error: 'No API key configured' });
    }

    // Test the key with a minimal request
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });

    res.json({
      success: true,
      model: response.model,
      message: 'Connection successful',
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

function getDefaultPermissions() {
  return {
    pr_review: true,
    pr_merge_review: true,
    smart_merge_analysis: true,
    sql_review: true,
    schema_suggestions: false,
    auto_review_on_create: false,
    max_tokens_per_request: 4000,
    model: 'claude-sonnet-4-20250514',
  };
}

module.exports = router;
