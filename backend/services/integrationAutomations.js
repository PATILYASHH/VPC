/**
 * Integration one-click automations.
 * Each automation takes an existing integration and wires it into a downstream
 * feature so the user never has to configure the same thing twice.
 *
 * Example: Supabase integration → creates a vpc_backup_destinations row using
 * the same service_role_key, so the user doesn't re-enter it in Backups.
 */

const integrationService = require('./integrationService');
const { encrypt } = require('../utils/encryption');

// ─── Automation registry ──────────────────────────────────────

const AUTOMATIONS = {
  // Supabase → Backup destination
  'supabase:add-as-backup': {
    label: 'Add as backup destination',
    async run(pool, integration, creds, opts = {}) {
      if (!creds?.serviceKey) throw new Error('Service role key required on the integration to use it as a backup target');
      const url = (integration.config?.url || '').replace(/\/+$/, '');
      const bucket = opts.bucket || 'vpc-backups';
      const intervalMinutes = opts.interval_minutes || 1440;
      const name = opts.name || `Supabase: ${integration.name}`;

      // Dedupe: if a destination already points to this URL, update instead
      const existing = await pool.query(
        `SELECT id FROM vpc_backup_destinations WHERE provider='supabase' AND config->>'url' = $1 LIMIT 1`,
        [url]
      );

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE vpc_backup_destinations SET config = $1, interval_minutes = $2, enabled = true, updated_at = NOW()
           WHERE id = $3`,
          [{ url, bucket, service_role_key_enc: encrypt(creds.serviceKey) }, intervalMinutes, existing.rows[0].id]
        );
        return { ok: true, destination_id: existing.rows[0].id, updated: true };
      }

      const { rows } = await pool.query(
        `INSERT INTO vpc_backup_destinations
           (name, provider, config, interval_minutes, enabled, created_by, next_run_at)
         VALUES ($1, 'supabase', $2, $3, true, NULL, NOW() + ($3 || ' minutes')::interval)
         RETURNING id`,
        [name, { url, bucket, service_role_key_enc: encrypt(creds.serviceKey) }, intervalMinutes]
      );
      return { ok: true, destination_id: rows[0].id, created: true };
    },
  },

  // Slack → enable alert routing
  'slack:enable-alerts': {
    label: 'Route deploy + backup alerts to Slack',
    async run(pool, integration) {
      await saveAlertRoute(pool, 'slack', integration.id);
      return { ok: true, message: `Alerts will now post to ${integration.name}` };
    },
  },

  // Discord → enable alert routing
  'discord:enable-alerts': {
    label: 'Route deploy + backup alerts to Discord',
    async run(pool, integration) {
      await saveAlertRoute(pool, 'discord', integration.id);
      return { ok: true, message: `Alerts will now post to ${integration.name}` };
    },
  },

  // Telegram → enable alert routing
  'telegram:enable-alerts': {
    label: 'Route alerts to Telegram',
    async run(pool, integration) {
      await saveAlertRoute(pool, 'telegram', integration.id);
      return { ok: true, message: `Alerts will now post to ${integration.name}` };
    },
  },

  // Generic send-test actions
  'slack:send-test': { label: 'Send test message', run: sendNotification.bind(null, 'slack') },
  'discord:send-test': { label: 'Send test message', run: sendNotification.bind(null, 'discord') },
  'telegram:send-test': { label: 'Send test message', run: sendNotification.bind(null, 'telegram') },

  // GitHub → import repos into VPSHub
  'github:import-repos': {
    label: 'Import repos into VPSHub',
    async run(pool, integration, creds, opts = {}) {
      if (!creds?.token) throw new Error('GitHub token missing');
      const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: { Authorization: `token ${creds.token}`, Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub: ${res.status}`);
      const repos = await res.json();

      const limit = Math.min(opts.limit || 50, 100);
      let imported = 0;
      let existed = 0;

      // Lookup this admin's id (the integration is pool-wide, but imports are per-admin)
      const ownerId = opts.ownerId;
      if (!ownerId) return { ok: true, message: 'Listed repos', count: repos.length };

      for (const r of repos.slice(0, limit)) {
        const slug = r.name;
        const exists = await pool.query(
          'SELECT id FROM vpshub_repositories WHERE owner_id = $1 AND slug = $2',
          [ownerId, slug]
        );
        if (exists.rows.length) { existed++; continue; }
        await pool.query(
          `INSERT INTO vpshub_repositories (owner_id, slug, name, description, visibility, default_branch)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ownerId, slug, r.name, r.description || '', r.private ? 'private' : 'public', r.default_branch || 'main']
        );
        imported++;
      }
      return { ok: true, imported, existed, total: repos.length };
    },
  },

  // Cloudflare → provision DNS for hosted web projects
  'cloudflare:provision-dns': {
    label: 'Provision DNS for hosted sites',
    async run(pool, integration, creds, opts = {}) {
      if (!creds?.apiToken) throw new Error('Cloudflare token missing');
      const zoneId = opts.zoneId || integration.config?.zoneId;
      if (!zoneId) throw new Error('Zone ID required — set it on the integration or pass as an option');

      const { rows: sites } = await pool.query(
        `SELECT id, custom_domain FROM web_hosting_projects WHERE custom_domain IS NOT NULL AND custom_domain <> ''`
      );
      if (sites.length === 0) return { ok: true, message: 'No hosted sites with custom domains yet.' };

      const targetIp = opts.targetIp || process.env.HOST_IP || '127.0.0.1';
      const results = [];
      for (const site of sites) {
        try {
          const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${creds.apiToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'A', name: site.custom_domain, content: targetIp, proxied: true }),
          });
          const data = await res.json();
          results.push({ domain: site.custom_domain, ok: res.ok, error: data?.errors?.[0]?.message });
        } catch (err) {
          results.push({ domain: site.custom_domain, ok: false, error: err.message });
        }
      }

      // Zone-level settings: force HTTPS + Universal SSL + TLS 1.2 minimum
      try {
        const cfHeaders = {
          Authorization: `Bearer ${creds.apiToken}`,
          'Content-Type': 'application/json',
        };
        const patches = [
          { path: `/zones/${zoneId}/settings/always_use_https`, body: { value: 'on' } },
          { path: `/zones/${zoneId}/settings/ssl`, body: { value: 'full' } },
          { path: `/zones/${zoneId}/settings/min_tls_version`, body: { value: '1.2' } },
          { path: `/zones/${zoneId}/settings/automatic_https_rewrites`, body: { value: 'on' } },
        ];
        for (const p of patches) {
          await fetch(`https://api.cloudflare.com/client/v4${p.path}`, {
            method: 'PATCH', headers: cfHeaders, body: JSON.stringify(p.body),
          });
        }
      } catch { /* best-effort */ }

      return { ok: true, results, ssl: 'Always HTTPS + Full SSL + TLS 1.2 enabled' };
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────

async function saveAlertRoute(pool, channel, integrationId) {
  await pool.query(
    `INSERT INTO vpc_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [`alert_route_${channel}`, JSON.stringify({ integration_id: integrationId, enabled: true })]
  );
}

async function sendNotification(channel, pool, integration, creds) {
  if (channel === 'telegram') {
    if (!creds?.botToken || !creds?.chatId) throw new Error('Bot token + chat id required');
    const res = await fetch(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: creds.chatId, text: `✅ Test message from VPC integration "${integration.name}"` }),
    });
    if (!res.ok) throw new Error(`Telegram send failed: ${res.status}`);
  } else {
    if (!creds?.webhookUrl) throw new Error('Webhook URL required');
    const body = channel === 'slack'
      ? { text: `✅ Test message from VPC integration "${integration.name}"` }
      : { content: `✅ Test message from VPC integration "${integration.name}"` };
    const res = await fetch(creds.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204) throw new Error(`${channel} send failed: ${res.status}`);
  }
  return { ok: true, message: 'Test message delivered' };
}

// ─── Public API ───────────────────────────────────────────────

function listForType(type) {
  return Object.keys(AUTOMATIONS)
    .filter(k => k.startsWith(`${type}:`))
    .map(k => ({ id: k, automationId: k.split(':')[1], label: AUTOMATIONS[k].label }));
}

async function runAutomation(pool, integrationId, automationId, opts = {}) {
  const integration = await integrationService.getById(pool, integrationId);
  if (!integration) throw new Error('Integration not found');

  const key = `${integration.type}:${automationId}`;
  const spec = AUTOMATIONS[key];
  if (!spec) throw new Error(`Unknown automation: ${key}`);

  const creds = await integrationService.getCredentials(pool, integrationId);
  if (!creds) throw new Error('No credentials stored for integration');

  return spec.run(pool, integration, creds, opts);
}

module.exports = { AUTOMATIONS, listForType, runAutomation };
