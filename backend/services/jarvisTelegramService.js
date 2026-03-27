/**
 * Jarvis Telegram Bot — allows chatting with Jarvis from Telegram.
 * Polls for new messages, identifies user by chat ID, runs full AI chat,
 * and sends responses back. Also supports proactive messages.
 */

const https = require('https');
const aiAgent = require('./aiAgentService');

const TELEGRAM_API = 'https://api.telegram.org';
let pollingActive = false;
let pollingTimer = null;
let botToken = null;
let pool = null;
let decryptFn = null;

// ── Telegram API helpers ─────────────────────────────────────────────────

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    if (!botToken) return reject(new Error('No bot token'));
    const url = new URL(`${TELEGRAM_API}/bot${botToken}/${method}`);
    const data = JSON.stringify(body);
    const req = https.request({
      method: 'POST', hostname: url.hostname, path: url.pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(d);
          p.ok ? resolve(p.result) : reject(new Error(p.description || 'Telegram error'));
        } catch { reject(new Error('Invalid Telegram response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendTgMessage(chatId, text) {
  // Telegram max message length is 4096
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, 4000));
    remaining = remaining.slice(4000);
  }
  // Send as plain text — no parse_mode to avoid formatting issues
  return Promise.all(chunks.map(chunk =>
    tgRequest('sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    })
  ));
}

// Strip markdown formatting that Claude might produce
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')      // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')           // *italic* → italic
    .replace(/__(.+?)__/g, '$1')           // __underline__ → underline
    .replace(/_(.+?)_/g, '$1')             // _italic_ → italic
    .replace(/~~(.+?)~~/g, '$1')           // ~~strike~~ → strike
    .replace(/`{3}[\s\S]*?`{3}/g, (m) =>  // ```code blocks``` → keep content
      m.replace(/`{3}\w*\n?/g, '').trim()
    )
    .replace(/`(.+?)`/g, '$1')            // `inline code` → inline code
    .replace(/^#{1,6}\s+/gm, '')           // ### headers → plain text
    .replace(/^\s*[-*+]\s+/gm, '• ')       // - list items → bullet
    .replace(/^\s*\d+\.\s+/gm, (m) => m)  // numbered lists stay
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // [text](url) → text
}

function sendTyping(chatId) {
  return tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
}

// ── User lookup ──────────────────────────────────────────────────────────

async function findUserByChatId(chatId) {
  const chatStr = String(chatId);
  const { rows } = await pool.query(
    'SELECT * FROM ai_agent_users WHERE telegram_chat_id = $1', [chatStr]
  );
  return rows[0] || null;
}

// ── Polling ──────────────────────────────────────────────────────────────

async function getOffset() {
  try {
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'jarvis_telegram_offset'");
    return rows[0]?.value ? parseInt(rows[0].value) : 0;
  } catch { return 0; }
}

async function setOffset(offset) {
  try {
    await pool.query(`
      INSERT INTO vpc_settings (key, value, is_secret, updated_at) VALUES ('jarvis_telegram_offset', $1, FALSE, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [String(offset)]);
  } catch {}
}

async function pollOnce() {
  if (!botToken || !pool) return;

  try {
    const offset = await getOffset();
    const updates = await tgRequest('getUpdates', {
      offset: offset || undefined,
      timeout: 10,
      allowed_updates: ['message'],
    });

    if (!updates || !updates.length) return;

    for (const update of updates) {
      await setOffset(update.update_id + 1);

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // Skip commands we don't handle
      if (text === '/start') {
        await sendTgMessage(chatId, '🤖 Jarvis AI Agent\n\nI\'m your VPC server assistant. Send me any command or question.\n\nYour Chat ID: ' + chatId + '\n\nIf you\'re not registered, ask your admin to add this Chat ID in VPC → AI Agent → Users.');
        continue;
      }

      // Find user
      const user = await findUserByChatId(chatId);
      if (!user) {
        await sendTgMessage(chatId, '⚠️ I don\'t recognize this chat ID.\n\nYour Chat ID: ' + chatId + '\n\nAsk your admin to link it in VPC → AI Agent → Users.');
        continue;
      }

      // Show typing indicator
      await sendTyping(chatId);

      // Run Jarvis chat
      try {
        const result = await aiAgent.chat(text, user.id, pool, { channel: 'telegram' });
        let response = result.response || 'Done.';

        // Strip markdown formatting — Telegram doesn't support **bold** or other MD
        response = stripMarkdown(response);

        // Add tool execution info
        if (result.toolResults?.length) {
          const toolInfo = result.toolResults
            .filter(t => t.tool !== 'store_memory')
            .map(t => t.error ? `❌ ${t.tool}: ${t.error}` : `✅ ${t.tool}`)
            .join('\n');
          if (toolInfo) response += '\n\nActions:\n' + toolInfo;
        }

        await sendTgMessage(chatId, response);
      } catch (err) {
        await sendTgMessage(chatId, '❌ Error: ' + stripMarkdown((err.message || 'Unknown error').slice(0, 500)));
      }
    }
  } catch (err) {
    // Network errors, token issues — log silently
    if (!err.message?.includes('terminated by other getUpdates')) {
      console.error('[Jarvis Telegram] Poll error:', err.message);
    }
  }
}

function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  console.log('[Jarvis Telegram] Bot polling started');

  async function loop() {
    while (pollingActive) {
      await pollOnce();
      // Small delay between polls (Telegram long-polling handles the wait)
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  loop();
}

function stopPolling() {
  pollingActive = false;
  if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
  console.log('[Jarvis Telegram] Bot polling stopped');
}

// ── Init / reload ────────────────────────────────────────────────────────

async function init(dbPool, decrypt) {
  pool = dbPool;
  decryptFn = decrypt;
  await reload();
}

async function reload() {
  if (!pool || !decryptFn) return;

  try {
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'telegram_bot_token'");
    if (rows[0]?.value) {
      const token = decryptFn(rows[0].value);
      if (token && token !== botToken) {
        stopPolling();
        botToken = token;
        // Verify token works
        try {
          const me = await tgRequest('getMe', {});
          console.log(`[Jarvis Telegram] Bot connected: @${me.username}`);
          startPolling();
        } catch (err) {
          console.error('[Jarvis Telegram] Invalid bot token:', err.message);
          botToken = null;
        }
      } else if (token && !pollingActive) {
        startPolling();
      }
    } else {
      if (pollingActive) stopPolling();
      botToken = null;
    }
  } catch (err) {
    console.error('[Jarvis Telegram] Init error:', err.message);
  }
}

// ── Proactive messaging ──────────────────────────────────────────────────

/**
 * Send a proactive message to all registered Telegram users.
 * Used by Jarvis when it detects emergencies or wants to alert the team.
 */
async function broadcast(message) {
  if (!botToken || !pool) return;
  try {
    const { rows } = await pool.query(
      'SELECT telegram_chat_id FROM ai_agent_users WHERE telegram_chat_id IS NOT NULL'
    );
    for (const row of rows) {
      await sendTgMessage(row.telegram_chat_id, message).catch(() => {});
    }
  } catch {}
}

/**
 * Send a proactive message to a specific user by name.
 */
async function messageUser(userName, message) {
  if (!botToken || !pool) return;
  try {
    const { rows } = await pool.query(
      'SELECT telegram_chat_id FROM ai_agent_users WHERE name = $1 AND telegram_chat_id IS NOT NULL',
      [userName]
    );
    if (rows[0]) {
      await sendTgMessage(rows[0].telegram_chat_id, message);
    }
  } catch {}
}

module.exports = {
  init,
  reload,
  startPolling,
  stopPolling,
  broadcast,
  messageUser,
  sendTgMessage,
};
