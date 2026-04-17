const { encrypt, decrypt, maskSecret } = require('../utils/encryption');

// ─── Integration Type Definitions ────────────────────────────

const INTEGRATION_TYPES = {
  github: {
    name: 'GitHub',
    description: 'Git hosting, repositories & pull requests',
    icon: 'github',
    category: 'Development',
    fields: [
      { key: 'token', label: 'Personal Access Token', type: 'secret', required: true, placeholder: 'ghp_xxxxxxxxxxxx' },
    ],
  },
  supabase: {
    name: 'Supabase',
    description: 'Database hosting, auth & storage',
    icon: 'database',
    category: 'Database',
    fields: [
      { key: 'url', label: 'Project URL', type: 'string', required: true, placeholder: 'https://xxxxx.supabase.co' },
      { key: 'anonKey', label: 'Anon Key', type: 'secret', required: true, placeholder: 'eyJhbGciOi...' },
      { key: 'serviceKey', label: 'Service Role Key', type: 'secret', required: false, placeholder: 'eyJhbGciOi...' },
    ],
  },
  docker: {
    name: 'Docker Hub',
    description: 'Container image registry',
    icon: 'container',
    category: 'Infrastructure',
    fields: [
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'token', label: 'Access Token', type: 'secret', required: true, placeholder: 'dckr_pat_xxxx' },
    ],
  },
  cloudflare: {
    name: 'Cloudflare',
    description: 'DNS, SSL & CDN for custom domains',
    icon: 'shield',
    category: 'Infrastructure',
    fields: [
      { key: 'email', label: 'Account Email', type: 'string', required: true },
      { key: 'apiToken', label: 'API Token', type: 'secret', required: true },
      { key: 'zoneId', label: 'Zone ID (optional)', type: 'string', required: false },
    ],
  },
  slack: {
    name: 'Slack',
    description: 'Team notifications & deploy alerts',
    icon: 'message',
    category: 'Notifications',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true, placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'channel', label: 'Channel (optional)', type: 'string', required: false, placeholder: '#deployments' },
    ],
  },
  discord: {
    name: 'Discord',
    description: 'Server notifications & deploy alerts',
    icon: 'message',
    category: 'Notifications',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true, placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  smtp: {
    name: 'SMTP Email',
    description: 'Send email alerts & reports',
    icon: 'mail',
    category: 'Notifications',
    fields: [
      { key: 'host', label: 'SMTP Host', type: 'string', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', type: 'number', required: true, placeholder: '587' },
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'password', label: 'Password', type: 'secret', required: true },
      { key: 'from', label: 'From Address', type: 'string', required: true, placeholder: 'alerts@example.com' },
    ],
  },
};

// ─── Credential Helpers ──────────────────────────────────────

function credentialsKey(integrationId) {
  return `integration_${integrationId}_creds`;
}

async function storeCredentials(pool, integrationId, credentials) {
  const key = credentialsKey(integrationId);
  const encrypted = encrypt(JSON.stringify(credentials));
  await pool.query(
    `INSERT INTO vpc_settings (key, value, is_secret, updated_at)
     VALUES ($1, $2, TRUE, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, encrypted]
  );
  // Store the key reference on the integration row
  await pool.query(
    'UPDATE vpc_integrations SET credentials_key = $1 WHERE id = $2',
    [key, integrationId]
  );
}

async function getCredentials(pool, integrationId) {
  const key = credentialsKey(integrationId);
  const { rows } = await pool.query('SELECT value FROM vpc_settings WHERE key = $1', [key]);
  if (!rows[0]?.value) return null;
  const decrypted = decrypt(rows[0].value);
  if (!decrypted) return null;
  try { return JSON.parse(decrypted); } catch { return null; }
}

async function deleteCredentials(pool, integrationId) {
  const key = credentialsKey(integrationId);
  await pool.query('DELETE FROM vpc_settings WHERE key = $1', [key]);
}

// ─── CRUD ────────────────────────────────────────────────────

async function getAll(pool) {
  const { rows } = await pool.query('SELECT * FROM vpc_integrations ORDER BY created_at DESC');
  return rows;
}

async function getById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM vpc_integrations WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create(pool, { type, name, config, credentials }) {
  if (!INTEGRATION_TYPES[type]) throw new Error(`Unknown integration type: ${type}`);

  const { rows } = await pool.query(
    `INSERT INTO vpc_integrations (type, name, config)
     VALUES ($1, $2, $3) RETURNING *`,
    [type, name, JSON.stringify(config || {})]
  );
  const integration = rows[0];

  // Store encrypted credentials
  if (credentials && Object.keys(credentials).length > 0) {
    await storeCredentials(pool, integration.id, credentials);
  }

  return integration;
}

async function update(pool, id, { name, config, credentials }) {
  const sets = ['updated_at = NOW()'];
  const vals = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
  if (config !== undefined) { sets.push(`config = $${idx++}`); vals.push(JSON.stringify(config)); }

  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE vpc_integrations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  if (credentials && Object.keys(credentials).length > 0) {
    await storeCredentials(pool, id, credentials);
  }

  return rows[0];
}

async function remove(pool, id) {
  await deleteCredentials(pool, id);
  await pool.query('DELETE FROM vpc_integrations WHERE id = $1', [id]);
}

// ─── Connection Testers ──────────────────────────────────────

async function testConnection(pool, id) {
  const integration = await getById(pool, id);
  if (!integration) throw new Error('Integration not found');

  const credentials = await getCredentials(pool, id);
  const config = integration.config || {};
  const start = Date.now();
  let result;

  try {
    switch (integration.type) {
      case 'github': result = await testGitHub(credentials); break;
      case 'supabase': result = await testSupabase(config, credentials); break;
      case 'docker': result = await testDocker(credentials); break;
      case 'cloudflare': result = await testCloudflare(credentials); break;
      case 'slack': result = await testSlack(credentials); break;
      case 'discord': result = await testDiscord(credentials); break;
      case 'smtp': result = await testSmtp(config, credentials); break;
      default: result = { ok: false, error: 'Unknown type' };
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }

  result.latency = Date.now() - start;

  // Update status and metadata
  await pool.query(
    `UPDATE vpc_integrations SET status = $1, last_checked_at = NOW(), metadata = $2, updated_at = NOW() WHERE id = $3`,
    [result.ok ? 'connected' : 'error', JSON.stringify(result.metadata || {}), id]
  );

  return result;
}

async function testGitHub(creds) {
  if (!creds?.token) throw new Error('Token not configured');
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${creds.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`);
  const user = await res.json();
  return {
    ok: true,
    metadata: { login: user.login, avatar_url: user.avatar_url, name: user.name, public_repos: user.public_repos, plan: user.plan?.name },
  };
}

async function testSupabase(config, creds) {
  if (!config?.url || !creds?.anonKey) throw new Error('URL and Anon Key required');
  const url = config.url.replace(/\/$/, '');
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: creds.anonKey, Authorization: `Bearer ${creds.anonKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 200) throw new Error(`Supabase: ${res.status} ${res.statusText}`);
  return {
    ok: true,
    metadata: { url: config.url, hasServiceKey: !!creds.serviceKey },
  };
}

async function testDocker(creds) {
  if (!creds?.username || !creds?.token) throw new Error('Username and token required');
  // Docker Hub auth
  const authRes = await fetch('https://hub.docker.com/v2/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.token }),
    signal: AbortSignal.timeout(10000),
  });
  if (!authRes.ok) throw new Error(`Docker Hub: ${authRes.status} authentication failed`);
  const { token } = await authRes.json();

  const repoRes = await fetch(`https://hub.docker.com/v2/repositories/${creds.username}/?page_size=1`, {
    headers: { Authorization: `JWT ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const repoData = repoRes.ok ? await repoRes.json() : { count: 0 };

  return {
    ok: true,
    metadata: { username: creds.username, repos: repoData.count || 0 },
  };
}

async function testCloudflare(creds) {
  if (!creds?.apiToken) throw new Error('API Token required');
  const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${creds.apiToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Cloudflare: ${data.errors?.[0]?.message || 'Token invalid'}`);
  return {
    ok: true,
    metadata: { status: data.result?.status, email: creds.email },
  };
}

async function testSlack(creds) {
  if (!creds?.webhookUrl) throw new Error('Webhook URL required');
  const res = await fetch(creds.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'VPC OS integration test — connection successful.' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Slack: ${res.status} ${res.statusText}`);
  return { ok: true, metadata: { channel: creds.channel || 'default' } };
}

async function testDiscord(creds) {
  if (!creds?.webhookUrl) throw new Error('Webhook URL required');
  const res = await fetch(creds.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'VPC OS integration test — connection successful.' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Discord: ${res.status} ${res.statusText}`);
  return { ok: true, metadata: {} };
}

async function testSmtp(config, creds) {
  if (!config?.host || !config?.port || !creds?.username || !creds?.password) {
    throw new Error('Host, port, username, and password required');
  }
  // Basic TCP connection test to the SMTP port
  const net = require('net');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: parseInt(config.port), timeout: 10000 });
    socket.on('connect', () => {
      socket.destroy();
      resolve({
        ok: true,
        metadata: { host: config.host, port: config.port, from: config.from || creds.username },
      });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP connection timed out')); });
    socket.on('error', (err) => { reject(new Error(`SMTP: ${err.message}`)); });
  });
}

module.exports = {
  INTEGRATION_TYPES,
  getAll,
  getById,
  create,
  update,
  remove,
  testConnection,
  getCredentials,
};
