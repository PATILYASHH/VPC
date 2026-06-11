const express = require('express');
const router = express.Router();
const { encrypt, decrypt, maskSecret } = require('../utils/encryption');

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

// ─── Generic settings CRUD ───────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    const { rows } = await pool.query('SELECT key, value, is_secret, updated_at, updated_by FROM vpc_settings ORDER BY key');
    const settings = {};
    for (const row of rows) {
      if (row.is_secret && row.value) {
        settings[row.key] = { value: maskSecret(decrypt(row.value)), is_set: true, is_secret: true, updated_at: row.updated_at };
      } else {
        settings[row.key] = { value: row.value, is_set: !!row.value, is_secret: false, updated_at: row.updated_at };
      }
    }
    res.json({ settings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    res.json({ success: true, key: req.params.key });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    await pool.query('DELETE FROM vpc_settings WHERE key = $1', [req.params.key]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
// AI AGENT — Bot
// ══════════════════════════════════════════════════════════════════════════

const aiAgent = require('../services/aiAgentService');

// ─── Test CLI ────────────────────────────────────────────────────────────

router.post('/ai-agent/test', async (req, res) => {
  try {
    const aiProvider = require('../services/aiProviderService');
    const ok = await aiProvider.isAnyAvailable(req.app.get('pool'));
    if (!ok) return res.json({ success: false, error: 'No AI provider available. Configure at least one provider to enable AI agent.' });
    const result = await aiProvider.chat('Say "Bot online"', { pool: req.app.get('pool') });
    res.json({ success: true, message: 'Bot is online', response: (result.text || '').slice(0, 200) });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ─── Chat ────────────────────────────────────────────────────────────────

router.post('/ai-agent/chat', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { message, userId, provider, model } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });
    const result = await aiAgent.chat(message, userId || null, pool, { provider, model });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Personality ─────────────────────────────────────────────────────────

router.get('/ai-agent/personality', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'ai_agent_personality'");
    res.json({ personality: rows[0]?.value || aiAgent.getDefaultPersonality() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-agent/personality', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    await pool.query(`
      INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by)
      VALUES ('ai_agent_personality', $1, FALSE, NOW(), $2)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2
    `, [req.body.personality, req.admin?.username || 'system']);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Users ───────────────────────────────────────────────────────────────

router.get('/ai-agent/users', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query('SELECT * FROM ai_agent_users ORDER BY is_default DESC, name');
    res.json({ users: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-agent/users', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, displayName, greeting, isDefault, telegramChatId } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (isDefault) await pool.query('UPDATE ai_agent_users SET is_default = false');
    const { rows } = await pool.query(
      'INSERT INTO ai_agent_users (name, display_name, greeting, is_default, telegram_chat_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, displayName || name, greeting || '', !!isDefault, telegramChatId || null]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'User with this name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/ai-agent/users/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, displayName, greeting, isDefault, telegramChatId } = req.body;
    if (isDefault) await pool.query('UPDATE ai_agent_users SET is_default = false');
    const { rows } = await pool.query(
      'UPDATE ai_agent_users SET name = COALESCE($1, name), display_name = COALESCE($2, display_name), greeting = COALESCE($3, greeting), is_default = COALESCE($4, is_default), telegram_chat_id = COALESCE($5, telegram_chat_id), updated_at = NOW() WHERE id = $6 RETURNING *',
      [name, displayName, greeting, isDefault, telegramChatId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-agent/users/:id', async (req, res) => {
  try {
    await req.app.locals.pool.query('DELETE FROM ai_agent_users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Memory ──────────────────────────────────────────────────────────────

router.get('/ai-agent/users/:id/memory', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      'SELECT * FROM ai_agent_memory WHERE user_id = $1 ORDER BY created_at DESC', [req.params.id]
    );
    res.json({ memories: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-agent/users/:id/memory', async (req, res) => {
  try {
    const { fact, category } = req.body;
    if (!fact) return res.status(400).json({ error: 'Fact is required' });
    const { rows } = await req.app.locals.pool.query(
      'INSERT INTO ai_agent_memory (user_id, category, fact, source) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, category || 'general', fact, 'manual']
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-agent/memory/:memId', async (req, res) => {
  try {
    await req.app.locals.pool.query('DELETE FROM ai_agent_memory WHERE id = $1', [req.params.memId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Conversations ───────────────────────────────────────────────────────

router.get('/ai-agent/conversations/:userId', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      'SELECT * FROM ai_agent_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.params.userId]
    );
    res.json({ messages: rows.reverse() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-agent/conversations/:userId', async (req, res) => {
  try {
    await req.app.locals.pool.query('DELETE FROM ai_agent_conversations WHERE user_id = $1', [req.params.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Chat Mode + Scope ───────────────────────────────────────────────────

router.get('/ai-agent/chat-settings/:userId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = parseInt(req.params.userId, 10);
    const { rows } = await pool.query('SELECT * FROM ai_agent_chat_settings WHERE user_id = $1', [userId]);
    if (rows[0]) return res.json(rows[0]);
    res.json({
      user_id: userId, mode: 'read_write', scope_enabled: false,
      allowed_hosting_ids: null, allowed_db_ids: null, allowed_repo_ids: null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-agent/chat-settings/:userId', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = parseInt(req.params.userId, 10);
    const { mode, scope_enabled, allowed_hosting_ids, allowed_db_ids, allowed_repo_ids } = req.body;
    const safeMode = mode === 'read' ? 'read' : 'read_write';
    const intArray = a => Array.isArray(a) ? a.map(n => parseInt(n, 10)).filter(n => Number.isFinite(n)) : null;
    const { rows } = await pool.query(
      `INSERT INTO ai_agent_chat_settings (user_id, mode, scope_enabled, allowed_hosting_ids, allowed_db_ids, allowed_repo_ids, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         mode = EXCLUDED.mode,
         scope_enabled = EXCLUDED.scope_enabled,
         allowed_hosting_ids = EXCLUDED.allowed_hosting_ids,
         allowed_db_ids = EXCLUDED.allowed_db_ids,
         allowed_repo_ids = EXCLUDED.allowed_repo_ids,
         updated_at = NOW()
       RETURNING *`,
      [userId, safeMode, !!scope_enabled, intArray(allowed_hosting_ids), intArray(allowed_db_ids), intArray(allowed_repo_ids)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ai-agent/scope-resources', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const [hosting, dbs, repos] = await Promise.all([
      pool.query("SELECT id, name, slug, status, project_type FROM web_hosting_projects WHERE status != 'deleted' ORDER BY name"),
      pool.query("SELECT id, name, slug, status FROM db_projects WHERE status != 'deleted' ORDER BY name"),
      pool.query("SELECT id, name, slug FROM vpshub_repositories ORDER BY name").catch(() => ({ rows: [] })),
    ]);
    res.json({ hosting: hosting.rows, databases: dbs.rows, repos: repos.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Generated Document Downloads ────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const EXPORTS_DIR = path.join(__dirname, '..', 'exports');

router.get('/ai-agent/exports/:filename', async (req, res) => {
  try {
    const safe = path.basename(req.params.filename);
    const filepath = path.join(EXPORTS_DIR, safe);
    if (!filepath.startsWith(EXPORTS_DIR) || !fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.download(filepath, safe);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ai-agent/documents/:userId', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      'SELECT id, filename, format, byte_size, title, created_at FROM ai_agent_documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.userId]
    );
    res.json({ documents: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Single-action approve / deny ────────────────────────────────────────
// Re-runs a previously requested approval-needed tool with _approved: true.

router.post('/ai-agent/approve', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const aiAgent = require('../services/aiAgentService');
    const { userId, tool, params, decision } = req.body;
    if (decision === 'deny') {
      return res.json({ ok: true, denied: true });
    }
    const approvedParams = { ...(params || {}), _approved: true };
    const result = await aiAgent.executeTool(tool, approvedParams, userId || null, pool);
    // Persist as an assistant message so chat history reflects the action
    await pool.query(
      'INSERT INTO ai_agent_conversations (user_id, role, content, tool_calls) VALUES ($1, $2, $3, $4)',
      [userId || null, 'assistant', `Executed ${tool} after approval.`, JSON.stringify([{ tool, params, result }])]
    );
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════
// TELEGRAM
// ══════════════════════════════════════════════════════════════════════════

router.get('/telegram/config', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    const { rows } = await pool.query(
      "SELECT key, value, is_secret FROM vpc_settings WHERE key IN ('telegram_bot_token', 'telegram_chat_id', 'telegram_notifications')"
    );
    const config = { bot_token_set: false, chat_id: '', notifications: getDefaultTelegramNotifications() };
    for (const row of rows) {
      if (row.key === 'telegram_bot_token' && row.value) {
        const dec = decrypt(row.value);
        config.bot_token_set = !!dec;
        config.bot_token_mask = dec ? maskSecret(dec) : '';
      } else if (row.key === 'telegram_chat_id') {
        config.chat_id = row.value || '';
      } else if (row.key === 'telegram_notifications') {
        try { config.notifications = { ...getDefaultTelegramNotifications(), ...JSON.parse(row.value) }; } catch {}
      }
    }
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/telegram/config', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    const { bot_token, chat_id, notifications } = req.body;
    const by = req.admin?.username || 'system';
    if (bot_token) {
      await pool.query(`INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by) VALUES ('telegram_bot_token', $1, TRUE, NOW(), $2)
        ON CONFLICT (key) DO UPDATE SET value = $1, is_secret = TRUE, updated_at = NOW(), updated_by = $2`, [encrypt(bot_token), by]);
    }
    if (chat_id !== undefined) {
      await pool.query(`INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by) VALUES ('telegram_chat_id', $1, FALSE, NOW(), $2)
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`, [chat_id, by]);
    }
    if (notifications) {
      await pool.query(`INSERT INTO vpc_settings (key, value, is_secret, updated_at, updated_by) VALUES ('telegram_notifications', $1, FALSE, NOW(), $2)
        ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`, [JSON.stringify(notifications), by]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/telegram/config', async (req, res) => {
  try {
    await req.app.locals.pool.query("DELETE FROM vpc_settings WHERE key IN ('telegram_bot_token', 'telegram_chat_id', 'telegram_notifications')");
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/telegram/test', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureTable(pool);
    let botToken = null;
    const { rows: tokenRows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'telegram_bot_token'");
    if (tokenRows[0]?.value) botToken = decrypt(tokenRows[0].value);
    if (req.body.bot_token) botToken = req.body.bot_token;
    if (!botToken) return res.json({ success: false, error: 'No bot token configured' });
    let chatId = req.body.chat_id;
    if (!chatId) {
      const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'telegram_chat_id'");
      chatId = rows[0]?.value;
    }
    const telegramService = require('../services/telegramService');
    const botInfo = await telegramService.testConnection(botToken);
    if (chatId) {
      await telegramService.sendMessage(botToken, chatId, '🔗 <b>VPC OS Connected!</b>\n\nTelegram notifications active.');
    }
    res.json({ success: true, bot: { username: botInfo.username, first_name: botInfo.first_name }, message_sent: !!chatId });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

function getDefaultTelegramNotifications() {
  return { pr_created: true, pr_reviewed: true, pr_merged: true, pr_closed: false, pr_reopened: false, pr_conflict: true, pr_test_passed: false, pr_test_failed: true, smart_merge: true, system_alerts: true };
}

// Reload Bot Telegram after config changes
router.post('/ai-agent/telegram/reload', async (req, res) => {
  try {
    const jarvisTg = require('../services/jarvisTelegramService');
    await jarvisTg.reload();
    res.json({ success: true, message: 'Telegram bot reloaded' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Bot Todos/Tasks ─────────────────────────────────────────

router.get('/ai-agent/todos', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const status = req.query.status; // optional filter: pending, in_progress, done, blocked
    let query = 'SELECT * FROM ai_agent_todos';
    const params = [];
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    query += ' ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 ELSE 3 END, created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json({ todos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-agent/todos', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { title, description, priority, assignedBy, assignedTo, dueDate } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const { rows } = await pool.query(
      `INSERT INTO ai_agent_todos (title, description, priority, assigned_by, assigned_to, due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description || null, priority || 'normal', assignedBy || 'User', assignedTo || 'Bot', dueDate ? new Date(dueDate) : null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-agent/todos/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { status, notes, title, priority } = req.body;
    const sets = ['updated_at = NOW()'];
    const vals = [];
    let i = 1;
    if (status) { sets.push(`status = $${i++}`); vals.push(status); }
    if (notes !== undefined) { sets.push(`notes = $${i++}`); vals.push(notes); }
    if (title) { sets.push(`title = $${i++}`); vals.push(title); }
    if (priority) { sets.push(`priority = $${i++}`); vals.push(priority); }
    if (status === 'done') sets.push('completed_at = NOW()');
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE ai_agent_todos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Todo not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-agent/todos/:id', async (req, res) => {
  try {
    await req.app.locals.pool.query('DELETE FROM ai_agent_todos WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Bot Activity Log (recent conversations with tool usage) ──

router.get('/ai-agent/activity', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { rows } = await pool.query(
      `SELECT c.*, u.name as user_name
       FROM ai_agent_conversations c
       LEFT JOIN ai_agent_users u ON c.user_id = u.id
       WHERE c.tool_calls IS NOT NULL
       ORDER BY c.created_at DESC LIMIT 50`
    );
    res.json({ activity: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── AI Provider Management ──────────────────────────────────

const aiProvider = require('../services/aiProviderService');

// List all providers with status
router.get('/ai-providers', async (req, res) => {
  try {
    const providers = await aiProvider.getAvailableProviders(req.app.locals.pool);
    const defaultId = await aiProvider.getDefaultProvider(req.app.locals.pool);
    res.json({ providers, default: defaultId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set default provider
router.put('/ai-providers/default', async (req, res) => {
  try {
    const { provider } = req.body;
    await aiProvider.setDefaultProvider(req.app.locals.pool, provider);
    res.json({ success: true, default: provider });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Set provider config (API key + model)
router.put('/ai-providers/:id', async (req, res) => {
  try {
    const { apiKey, model } = req.body;
    await aiProvider.setProviderConfig(req.app.locals.pool, req.params.id, { apiKey, model });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Test provider connection
router.post('/ai-providers/:id/test', async (req, res) => {
  try {
    const result = await aiProvider.testProvider(req.app.locals.pool, req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claude CLI status — check auth, version, subscription info
router.get('/ai-providers/claude-cli/status', async (req, res) => {
  try {
    const { execFile, spawn } = require('child_process');
    const { buildAugmentedEnv } = require('../utils/shellEnv');
    const status = { installed: false, version: null, authenticated: false, account: null };

    // Step 1: PATH-based existence check (instant, won't time out)
    status.installed = await aiProvider.isClaudeCliAvailable();
    if (!status.installed) return res.json(status);

    // Step 2: Read version (use augmented env + shell so .cmd shim resolves on Windows)
    await new Promise(resolve => {
      execFile('claude', ['--version'], {
        timeout: 10000,
        env: buildAugmentedEnv(),
        shell: process.platform === 'win32',
        windowsHide: true,
      }, (err, stdout) => {
        if (!err && stdout) status.version = stdout.trim();
        resolve();
      });
    });

    // Step 3: Check auth by running a quick non-interactive test
    await new Promise(resolve => {
      const proc = spawn('claude', ['-p', 'say ok', '--output-format', 'text'], {
        timeout: 30000,
        env: buildAugmentedEnv(),
        shell: process.platform === 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d; });
      proc.stderr.on('data', d => { stderr += d; });
      proc.on('close', code => {
        status.authenticated = code === 0 && stdout.trim().length > 0;
        if (stderr.includes('not authenticated') || stderr.includes('login') || stderr.includes('API key')) {
          status.authenticated = false;
        }
        resolve();
      });
      proc.on('error', () => resolve());
    });

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ollama status
router.get('/ollama/status', async (req, res) => {
  try {
    const status = await aiProvider.getOllamaStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ollama models
router.get('/ollama/models', async (req, res) => {
  try {
    const status = await aiProvider.getOllamaStatus();
    res.json({ models: status.models });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pull Ollama model
router.post('/ollama/pull', async (req, res) => {
  try {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Model name required' });
    const result = await aiProvider.pullOllamaModel(model);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Ollama model
router.delete('/ollama/models/:name', async (req, res) => {
  try {
    const result = await aiProvider.deleteOllamaModel(req.params.name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent API Keys (remote bot access) ──────────────────────────────────

const ALLOWED_AGENT_PERMS = ['view', 'edit', 'delete', 'repositories', 'database', 'claude'];

function sanitizeAgentPerms(permissions) {
  const perms = {};
  for (const p of ALLOWED_AGENT_PERMS) perms[p] = permissions?.[p] === true;
  return perms;
}

router.get('/ai-agent/api-keys', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(
      `SELECT id, name, key_prefix, permissions, store_history, is_active,
              rate_limit_per_minute, expires_at, last_used_at, total_requests, key_type, created_at
       FROM agent_api_keys ORDER BY created_at DESC`
    );
    res.json({ keys: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai-agent/api-keys', async (req, res) => {
  try {
    const crypto = require('crypto');
    const pool = req.app.locals.pool;
    const { name, permissions, store_history, expires_at, rate_limit_per_minute, key_type } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const type = key_type === 'claude' ? 'claude' : 'bot';
    const prefix = type === 'claude' ? 'vpccli_' : 'vpcbot_';
    const rawKey = prefix + crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.slice(0, prefix.length + 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    // Claude CLI keys get exactly the claude permission — no bot/tool access
    const perms = type === 'claude'
      ? { ...sanitizeAgentPerms({}), claude: true, view: false }
      : sanitizeAgentPerms(permissions);

    const { rows } = await pool.query(
      `INSERT INTO agent_api_keys (name, key_prefix, key_hash, permissions, store_history, expires_at, rate_limit_per_minute, key_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, key_prefix, permissions, store_history, is_active, rate_limit_per_minute, expires_at, key_type, created_at`,
      [name.trim(), keyPrefix, keyHash, JSON.stringify(perms), store_history === true,
       expires_at || null, rate_limit_per_minute || 30, type, req.admin?.id || null]
    );

    res.status(201).json({ ...rows[0], api_key: rawKey }); // raw key shown only once
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/ai-agent/api-keys/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, permissions, store_history, is_active, expires_at, rate_limit_per_minute } = req.body;
    const sets = [];
    const vals = [];
    let i = 1;
    if (name?.trim()) { sets.push(`name = $${i++}`); vals.push(name.trim()); }
    if (permissions) { sets.push(`permissions = $${i++}`); vals.push(JSON.stringify(sanitizeAgentPerms(permissions))); }
    if (typeof store_history === 'boolean') { sets.push(`store_history = $${i++}`); vals.push(store_history); }
    if (typeof is_active === 'boolean') { sets.push(`is_active = $${i++}`); vals.push(is_active); }
    if (expires_at !== undefined) { sets.push(`expires_at = $${i++}`); vals.push(expires_at || null); }
    if (rate_limit_per_minute) { sets.push(`rate_limit_per_minute = $${i++}`); vals.push(rate_limit_per_minute); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = NOW()');
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE agent_api_keys SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, name, key_prefix, permissions, store_history, is_active, rate_limit_per_minute, expires_at, last_used_at, total_requests, created_at`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'API key not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ai-agent/api-keys/:id', async (req, res) => {
  try {
    await req.app.locals.pool.query('DELETE FROM agent_api_keys WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export decrypt for telegramService
router.decrypt = decrypt;
module.exports = router;
