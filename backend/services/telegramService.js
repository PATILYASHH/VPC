const https = require('https');
const http = require('http');

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a message via Telegram Bot API.
 */
function sendRequest(botToken, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${TELEGRAM_API}/bot${botToken}/${method}`);
    const data = JSON.stringify(body);

    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (parsed.ok) {
            resolve(parsed.result);
          } else {
            reject(new Error(parsed.description || 'Telegram API error'));
          }
        } catch {
          reject(new Error('Invalid Telegram API response'));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Send a text message to a Telegram chat.
 */
async function sendMessage(botToken, chatId, text, options = {}) {
  return sendRequest(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode || 'HTML',
    disable_web_page_preview: true,
  });
}

/**
 * Test bot connection — calls getMe.
 */
async function testConnection(botToken) {
  return sendRequest(botToken, 'getMe', {});
}

/**
 * Format and send a PR status notification.
 */
async function notifyPRStatus(botToken, chatId, { event, pr, project, extra }) {
  const icons = {
    created: '🆕',
    reviewed: '🤖',
    merged: '✅',
    closed: '🔴',
    reopened: '🔄',
    conflict: '⚠️',
    test_passed: '🧪',
    test_failed: '❌',
    smart_merge: '🔀',
  };

  const icon = icons[event] || '📋';
  let message = '';

  switch (event) {
    case 'created':
      message = `${icon} <b>New PR Created</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`
        + `<b>By:</b> ${escapeHtml(pr.submitted_by || 'unknown')}\n`
        + (pr.description ? `\n${escapeHtml(pr.description.substring(0, 200))}` : '');
      break;

    case 'reviewed':
      message = `${icon} <b>AI Review Complete</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`;
      if (extra?.review) {
        const r = extra.review;
        message += `\n<b>Summary:</b> ${escapeHtml(r.summary || 'N/A')}\n`
          + `<b>Safe to merge:</b> ${r.safe_to_merge ? '✅ Yes' : '⚠️ No'}\n`;
        if (r.risks?.length > 0) {
          message += `\n<b>Risks:</b>\n${r.risks.map(risk => `  • ${escapeHtml(risk)}`).join('\n')}\n`;
        }
        if (r.review_notes) {
          message += `\n<i>${escapeHtml(r.review_notes.substring(0, 300))}</i>`;
        }
      }
      break;

    case 'merged':
      message = `${icon} <b>PR Merged</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`
        + `<b>Merged by:</b> ${escapeHtml(pr.merged_by || extra?.mergedBy || 'unknown')}`;
      break;

    case 'closed':
      message = `${icon} <b>PR Closed</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}`;
      break;

    case 'reopened':
      message = `${icon} <b>PR Reopened</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}`;
      break;

    case 'conflict':
      message = `${icon} <b>Conflicts Detected</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`;
      if (extra?.conflicts?.length > 0) {
        message += `\n<b>Conflicts:</b>\n${extra.conflicts.slice(0, 5).map(c => `  • ${escapeHtml(c.message)}`).join('\n')}`;
      }
      break;

    case 'test_passed':
      message = `${icon} <b>Sandbox Test Passed</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}`;
      break;

    case 'test_failed':
      message = `${icon} <b>Sandbox Test Failed</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`
        + (extra?.error ? `\n<b>Error:</b> <code>${escapeHtml(extra.error.substring(0, 300))}</code>` : '');
      break;

    case 'smart_merge':
      message = `${icon} <b>Smart Merge Complete</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`;
      if (extra?.results) {
        const r = extra.results;
        message += `<b>Merged:</b> ${r.merged?.length || 0}\n`
          + `<b>Failed:</b> ${r.failed?.length || 0}\n`;
        if (r.merged?.length > 0) {
          message += `\n<b>Merged PRs:</b>\n${r.merged.map(m => `  ✅ #${m.pr_number} ${escapeHtml(m.title)}`).join('\n')}\n`;
        }
        if (r.failed?.length > 0) {
          message += `\n<b>Failed PRs:</b>\n${r.failed.map(f => `  ❌ #${f.pr_number} ${escapeHtml(f.title)}`).join('\n')}`;
        }
      }
      break;

    default:
      message = `${icon} <b>PR Update</b>\n\n`
        + `<b>Project:</b> ${escapeHtml(project?.name || 'Unknown')}\n`
        + `<b>PR #${pr.pr_number}:</b> ${escapeHtml(pr.title)}\n`
        + `<b>Event:</b> ${event}`;
  }

  try {
    await sendMessage(botToken, chatId, message);
    return { success: true };
  } catch (err) {
    console.error('[Telegram] Failed to send notification:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a system alert notification.
 */
async function notifySystemAlert(botToken, chatId, { title, message: msg, severity = 'info' }) {
  const icons = { info: 'ℹ️', warning: '⚠️', error: '🚨', critical: '🔥' };
  const icon = icons[severity] || 'ℹ️';

  const text = `${icon} <b>${escapeHtml(title)}</b>\n\n${escapeHtml(msg)}`;

  try {
    await sendMessage(botToken, chatId, text);
    return { success: true };
  } catch (err) {
    console.error('[Telegram] Failed to send system alert:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Helper to get Telegram config from the DB settings.
 */
async function getTelegramConfig(pool, decrypt) {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM vpc_settings WHERE key IN ('telegram_bot_token', 'telegram_chat_id', 'telegram_notifications')"
    );

    const config = {};
    for (const row of rows) {
      if (row.key === 'telegram_bot_token' && row.value) {
        config.botToken = decrypt(row.value);
      } else if (row.key === 'telegram_chat_id') {
        config.chatId = row.value;
      } else if (row.key === 'telegram_notifications') {
        try { config.notifications = JSON.parse(row.value); } catch { config.notifications = {}; }
      }
    }

    return config;
  } catch {
    return {};
  }
}

/**
 * Send a notification if Telegram is configured and enabled for the event type.
 */
async function notifyIfEnabled(pool, decrypt, eventType, payload) {
  const config = await getTelegramConfig(pool, decrypt);
  if (!config.botToken || !config.chatId) return { skipped: true, reason: 'not_configured' };

  // Check if this notification type is enabled
  const notifications = config.notifications || {};
  if (notifications[eventType] === false) return { skipped: true, reason: 'disabled' };

  return notifyPRStatus(config.botToken, config.chatId, payload);
}

/**
 * Send a system alert if Telegram is configured.
 */
async function alertIfEnabled(pool, decrypt, payload) {
  const config = await getTelegramConfig(pool, decrypt);
  if (!config.botToken || !config.chatId) return { skipped: true, reason: 'not_configured' };

  const notifications = config.notifications || {};
  if (notifications.system_alerts === false) return { skipped: true, reason: 'disabled' };

  return notifySystemAlert(config.botToken, config.chatId, payload);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  sendMessage,
  testConnection,
  notifyPRStatus,
  notifySystemAlert,
  getTelegramConfig,
  notifyIfEnabled,
  alertIfEnabled,
};
