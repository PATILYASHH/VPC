const { encrypt, decrypt, maskSecret } = require('../utils/encryption');

// ─── Integration Type Definitions ────────────────────────────

const INTEGRATION_TYPES = {
  // ─── Source Control ────────────────────────────────────────
  github: {
    name: 'GitHub', icon: 'github', category: 'Source Control',
    description: 'Git hosting, repositories & pull requests',
    automations: [
      { id: 'import-repos', label: 'Import all repos to VPSHub', icon: 'download' },
      { id: 'enable-pr-webhooks', label: 'Enable PR webhooks', icon: 'webhook' },
    ],
    fields: [
      { key: 'token', label: 'Personal Access Token', type: 'secret', required: true, placeholder: 'ghp_xxxxxxxxxxxx' },
    ],
  },
  gitlab: {
    name: 'GitLab', icon: 'gitlab', category: 'Source Control',
    description: 'GitLab.com or self-hosted',
    fields: [
      { key: 'url', label: 'GitLab URL', type: 'string', required: true, placeholder: 'https://gitlab.com' },
      { key: 'token', label: 'Personal Access Token', type: 'secret', required: true, placeholder: 'glpat-xxxxxxxxxxxx' },
    ],
  },
  bitbucket: {
    name: 'Bitbucket', icon: 'bitbucket', category: 'Source Control',
    description: 'Atlassian Bitbucket Cloud',
    fields: [
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'appPassword', label: 'App Password', type: 'secret', required: true },
    ],
  },

  // ─── Databases / BaaS ──────────────────────────────────────
  supabase: {
    name: 'Supabase', icon: 'database', category: 'Database & BaaS',
    description: 'PostgreSQL hosting, auth & storage',
    automations: [
      { id: 'add-as-backup', label: 'Use as backup destination', icon: 'cloud' },
    ],
    fields: [
      { key: 'url', label: 'Project URL', type: 'string', required: true, placeholder: 'https://xxxxx.supabase.co' },
      { key: 'anonKey', label: 'Anon Key', type: 'secret', required: true, placeholder: 'eyJhbGciOi...' },
      { key: 'serviceKey', label: 'Service Role Key', type: 'secret', required: false, placeholder: 'eyJhbGciOi...' },
    ],
  },
  firebase: {
    name: 'Firebase', icon: 'flame', category: 'Database & BaaS',
    description: 'Google Firebase / Firestore',
    fields: [
      { key: 'projectId', label: 'Project ID', type: 'string', required: true },
      { key: 'serviceAccountJson', label: 'Service Account JSON', type: 'secret', required: true, placeholder: '{ "type": "service_account", ... }' },
    ],
  },
  mongodb: {
    name: 'MongoDB Atlas', icon: 'leaf', category: 'Database & BaaS',
    description: 'MongoDB cluster',
    fields: [
      { key: 'connectionString', label: 'Connection String', type: 'secret', required: true, placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net' },
    ],
  },
  planetscale: {
    name: 'PlanetScale', icon: 'database', category: 'Database & BaaS',
    description: 'Serverless MySQL',
    fields: [
      { key: 'host', label: 'Host', type: 'string', required: true, placeholder: 'xxxx.psdb.cloud' },
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'password', label: 'Password', type: 'secret', required: true },
    ],
  },
  neon: {
    name: 'Neon', icon: 'database', category: 'Database & BaaS',
    description: 'Serverless Postgres',
    fields: [
      { key: 'connectionString', label: 'Connection String', type: 'secret', required: true, placeholder: 'postgres://user:pass@ep-xxx.neon.tech/neondb' },
    ],
  },
  redis: {
    name: 'Redis', icon: 'database', category: 'Database & BaaS',
    description: 'Cache / Pub-Sub',
    fields: [
      { key: 'url', label: 'Connection URL', type: 'secret', required: true, placeholder: 'redis://default:xxx@host:port' },
    ],
  },

  // ─── Container / Deploy ────────────────────────────────────
  docker: {
    name: 'Docker Hub', icon: 'container', category: 'Deploy & Containers',
    description: 'Container image registry',
    fields: [
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'token', label: 'Access Token', type: 'secret', required: true, placeholder: 'dckr_pat_xxxx' },
    ],
  },
  vercel: {
    name: 'Vercel', icon: 'triangle', category: 'Deploy & Containers',
    description: 'Serverless deploy platform',
    fields: [
      { key: 'token', label: 'API Token', type: 'secret', required: true, placeholder: 'xxxxxxxxxxxx' },
      { key: 'teamId', label: 'Team ID (optional)', type: 'string', required: false },
    ],
  },
  netlify: {
    name: 'Netlify', icon: 'triangle', category: 'Deploy & Containers',
    description: 'Static site + serverless deploy',
    fields: [
      { key: 'token', label: 'Personal Access Token', type: 'secret', required: true },
    ],
  },
  railway: {
    name: 'Railway', icon: 'train', category: 'Deploy & Containers',
    description: 'PaaS deploy platform',
    fields: [
      { key: 'token', label: 'Project Token', type: 'secret', required: true },
    ],
  },
  render: {
    name: 'Render', icon: 'cloud', category: 'Deploy & Containers',
    description: 'Cloud app hosting',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'rnd_xxxxxxxxxxxx' },
    ],
  },

  // ─── Cloud Providers ───────────────────────────────────────
  aws: {
    name: 'AWS', icon: 'cloud', category: 'Cloud Providers',
    description: 'S3, Lambda, RDS, etc.',
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', type: 'string', required: true, placeholder: 'AKIAxxxxxxxx' },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'secret', required: true },
      { key: 'region', label: 'Default Region', type: 'string', required: true, placeholder: 'us-east-1' },
    ],
  },
  gcp: {
    name: 'Google Cloud', icon: 'cloud', category: 'Cloud Providers',
    description: 'GCP service account',
    fields: [
      { key: 'projectId', label: 'Project ID', type: 'string', required: true },
      { key: 'serviceAccountJson', label: 'Service Account JSON', type: 'secret', required: true },
    ],
  },
  digitalocean: {
    name: 'DigitalOcean', icon: 'cloud', category: 'Cloud Providers',
    description: 'Droplets, Spaces, Managed DBs',
    fields: [
      { key: 'token', label: 'API Token', type: 'secret', required: true, placeholder: 'dop_v1_xxxxxxxx' },
    ],
  },
  cloudflare: {
    name: 'Cloudflare', icon: 'shield', category: 'Cloud Providers',
    description: 'DNS, SSL & CDN for custom domains',
    automations: [
      { id: 'provision-dns', label: 'Auto-provision DNS for hosted sites', icon: 'globe' },
    ],
    fields: [
      { key: 'email', label: 'Account Email', type: 'string', required: true },
      { key: 'apiToken', label: 'API Token', type: 'secret', required: true },
      { key: 'zoneId', label: 'Zone ID (optional)', type: 'string', required: false },
    ],
  },

  // ─── Object Storage ────────────────────────────────────────
  s3: {
    name: 'Amazon S3 / Compatible', icon: 'box', category: 'Object Storage',
    description: 'S3, R2, B2, MinIO, DO Spaces',
    fields: [
      { key: 'endpoint', label: 'Endpoint (optional)', type: 'string', required: false, placeholder: 'https://s3.amazonaws.com' },
      { key: 'region', label: 'Region', type: 'string', required: true, placeholder: 'us-east-1' },
      { key: 'bucket', label: 'Bucket', type: 'string', required: true },
      { key: 'accessKeyId', label: 'Access Key ID', type: 'string', required: true },
      { key: 'secretAccessKey', label: 'Secret Access Key', type: 'secret', required: true },
    ],
  },

  // ─── Notifications ─────────────────────────────────────────
  slack: {
    name: 'Slack', icon: 'message', category: 'Notifications',
    description: 'Team notifications & deploy alerts',
    automations: [
      { id: 'enable-alerts', label: 'Route deploy & backup alerts here', icon: 'bell' },
      { id: 'send-test', label: 'Send test message', icon: 'send' },
    ],
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true, placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'channel', label: 'Channel (optional)', type: 'string', required: false, placeholder: '#deployments' },
    ],
  },
  discord: {
    name: 'Discord', icon: 'message', category: 'Notifications',
    description: 'Server notifications & deploy alerts',
    automations: [
      { id: 'enable-alerts', label: 'Route deploy & backup alerts here', icon: 'bell' },
      { id: 'send-test', label: 'Send test message', icon: 'send' },
    ],
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true, placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  telegram: {
    name: 'Telegram', icon: 'send', category: 'Notifications',
    description: 'Bot notifications to a chat',
    automations: [
      { id: 'enable-alerts', label: 'Route alerts here', icon: 'bell' },
      { id: 'send-test', label: 'Send test message', icon: 'send' },
    ],
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'secret', required: true, placeholder: '123456:ABC-DEF...' },
      { key: 'chatId', label: 'Chat ID', type: 'string', required: true, placeholder: '-1001234567890' },
    ],
  },
  teams: {
    name: 'Microsoft Teams', icon: 'message', category: 'Notifications',
    description: 'Teams incoming webhook',
    fields: [
      { key: 'webhookUrl', label: 'Webhook URL', type: 'secret', required: true },
    ],
  },
  smtp: {
    name: 'SMTP Email', icon: 'mail', category: 'Notifications',
    description: 'Send email alerts & reports',
    fields: [
      { key: 'host', label: 'SMTP Host', type: 'string', required: true, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', type: 'number', required: true, placeholder: '587' },
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'password', label: 'Password', type: 'secret', required: true },
      { key: 'from', label: 'From Address', type: 'string', required: true, placeholder: 'alerts@example.com' },
    ],
  },
  sendgrid: {
    name: 'SendGrid', icon: 'mail', category: 'Notifications',
    description: 'Transactional email API',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'SG.xxxxxxxxxxxxx' },
      { key: 'from', label: 'From Address', type: 'string', required: true },
    ],
  },
  twilio: {
    name: 'Twilio SMS', icon: 'phone', category: 'Notifications',
    description: 'Send SMS alerts',
    fields: [
      { key: 'accountSid', label: 'Account SID', type: 'string', required: true, placeholder: 'ACxxxxxxxx' },
      { key: 'authToken', label: 'Auth Token', type: 'secret', required: true },
      { key: 'from', label: 'From Number', type: 'string', required: true, placeholder: '+15551234567' },
    ],
  },

  // ─── AI Providers ──────────────────────────────────────────
  openai: {
    name: 'OpenAI', icon: 'sparkles', category: 'AI Providers',
    description: 'GPT-4, embeddings, images',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'sk-xxxxxxxx' },
      { key: 'organization', label: 'Organization (optional)', type: 'string', required: false },
    ],
  },
  anthropic: {
    name: 'Anthropic', icon: 'sparkles', category: 'AI Providers',
    description: 'Claude API',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'sk-ant-xxxxxxxx' },
    ],
  },
  google_ai: {
    name: 'Google AI', icon: 'sparkles', category: 'AI Providers',
    description: 'Gemini API',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'AIza...' },
    ],
  },
  groq: {
    name: 'Groq', icon: 'sparkles', category: 'AI Providers',
    description: 'Fast inference LLM API',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'gsk_xxxxxxxx' },
    ],
  },

  // ─── Payments ──────────────────────────────────────────────
  stripe: {
    name: 'Stripe', icon: 'credit-card', category: 'Payments',
    description: 'Payment processing',
    fields: [
      { key: 'secretKey', label: 'Secret Key', type: 'secret', required: true, placeholder: 'sk_live_xxxxxxxx' },
      { key: 'webhookSecret', label: 'Webhook Secret (optional)', type: 'secret', required: false },
    ],
  },
  razorpay: {
    name: 'Razorpay', icon: 'credit-card', category: 'Payments',
    description: 'Payments for India',
    fields: [
      { key: 'keyId', label: 'Key ID', type: 'string', required: true, placeholder: 'rzp_live_xxxxxxxx' },
      { key: 'keySecret', label: 'Key Secret', type: 'secret', required: true },
    ],
  },

  // ─── Productivity / Project Mgmt ───────────────────────────
  notion: {
    name: 'Notion', icon: 'notebook', category: 'Productivity',
    description: 'Workspace pages & databases',
    fields: [
      { key: 'token', label: 'Integration Token', type: 'secret', required: true, placeholder: 'secret_xxxxxxxx' },
    ],
  },
  linear: {
    name: 'Linear', icon: 'line', category: 'Productivity',
    description: 'Issue tracking',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'secret', required: true, placeholder: 'lin_api_xxxxxxxx' },
    ],
  },
  jira: {
    name: 'Jira', icon: 'bug', category: 'Productivity',
    description: 'Atlassian Jira issue tracking',
    fields: [
      { key: 'url', label: 'Site URL', type: 'string', required: true, placeholder: 'https://your-domain.atlassian.net' },
      { key: 'email', label: 'Account Email', type: 'string', required: true },
      { key: 'apiToken', label: 'API Token', type: 'secret', required: true },
    ],
  },

  // ─── Generic ───────────────────────────────────────────────
  webhook: {
    name: 'Generic Webhook', icon: 'webhook', category: 'Generic',
    description: 'Any HTTP endpoint',
    fields: [
      { key: 'url', label: 'URL', type: 'string', required: true },
      { key: 'method', label: 'Method', type: 'string', required: false, placeholder: 'POST' },
      { key: 'bearer', label: 'Bearer Token (optional)', type: 'secret', required: false },
    ],
  },
  ssh: {
    name: 'SSH Host', icon: 'terminal', category: 'Generic',
    description: 'Remote server via SSH',
    fields: [
      { key: 'host', label: 'Host', type: 'string', required: true },
      { key: 'port', label: 'Port', type: 'number', required: false, placeholder: '22' },
      { key: 'username', label: 'Username', type: 'string', required: true },
      { key: 'privateKey', label: 'Private Key', type: 'secret', required: true },
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

async function getAll(pool, { forUserId } = {}) {
  if (forUserId) {
    // Filter: shared OR owned by user
    const { rows } = await pool.query(
      `SELECT * FROM vpc_integrations
       WHERE visibility = 'shared' OR created_by = $1
       ORDER BY created_at DESC`,
      [forUserId]
    );
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM vpc_integrations ORDER BY created_at DESC');
  return rows;
}

async function getById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM vpc_integrations WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create(pool, { type, name, config, credentials, visibility, createdBy }) {
  if (!INTEGRATION_TYPES[type]) throw new Error(`Unknown integration type: ${type}`);

  const { rows } = await pool.query(
    `INSERT INTO vpc_integrations (type, name, config, visibility, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [type, name, JSON.stringify(config || {}), visibility || 'shared', createdBy || null]
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

// ─── Defaults & resolution ───────────────────────────────────

async function getByType(pool, type) {
  const { rows } = await pool.query(
    'SELECT * FROM vpc_integrations WHERE type = $1 ORDER BY is_default DESC, created_at ASC',
    [type]
  );
  return rows;
}

async function getDefault(pool, type) {
  const { rows } = await pool.query(
    'SELECT * FROM vpc_integrations WHERE type = $1 AND is_default = TRUE LIMIT 1',
    [type]
  );
  if (rows[0]) return rows[0];
  // Fallback: first connected integration of this type
  const fallback = await pool.query(
    `SELECT * FROM vpc_integrations WHERE type = $1 ORDER BY
     CASE status WHEN 'connected' THEN 0 WHEN 'disconnected' THEN 1 ELSE 2 END,
     created_at ASC LIMIT 1`,
    [type]
  );
  return fallback.rows[0] || null;
}

async function setDefault(pool, id) {
  const integ = await getById(pool, id);
  if (!integ) throw new Error('Integration not found');
  // Clear any existing default for this type, then promote this one
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE vpc_integrations SET is_default = FALSE WHERE type = $1', [integ.type]);
    await client.query('UPDATE vpc_integrations SET is_default = TRUE WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getById(pool, id);
}

// Resolve credentials by type. If no integration_id provided, falls back to the type default.
async function resolveCredentials(pool, { type, integrationId } = {}) {
  let integration;
  if (integrationId) {
    integration = await getById(pool, integrationId);
  } else if (type) {
    integration = await getDefault(pool, type);
  }
  if (!integration) return null;
  const credentials = await getCredentials(pool, integration.id);
  return credentials ? { integration, credentials } : null;
}

async function recordUse(pool, { integrationId, appId, resourceKind, resourceId }) {
  if (!integrationId || !appId) return;
  try {
    await pool.query(
      `INSERT INTO vpc_integration_uses (integration_id, app_id, resource_kind, resource_id, last_used_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (integration_id, app_id, resource_kind, resource_id)
       DO UPDATE SET last_used_at = NOW()`,
      [integrationId, appId, resourceKind || '', resourceId || '']
    );
  } catch (err) {
    console.warn('[integrationService.recordUse] non-fatal:', err.message);
  }
}

async function listUses(pool, { integrationId } = {}) {
  if (integrationId) {
    const { rows } = await pool.query(
      `SELECT app_id, resource_kind, resource_id, last_used_at
       FROM vpc_integration_uses WHERE integration_id = $1 ORDER BY last_used_at DESC`,
      [integrationId]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT integration_id, app_id, COUNT(*)::int AS count, MAX(last_used_at) AS last_used_at
     FROM vpc_integration_uses GROUP BY integration_id, app_id`
  );
  return rows;
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
      case 'gitlab': result = await testGitLab(config, credentials); break;
      case 'bitbucket': result = await testBitbucket(credentials); break;
      case 'supabase': result = await testSupabase(config, credentials); break;
      case 'firebase': result = await testFirebase(credentials); break;
      case 'mongodb': result = await testMongoDB(credentials); break;
      case 'planetscale': result = await testGenericHost(credentials); break;
      case 'neon': result = await testPostgresConn(credentials); break;
      case 'redis': result = await testRedis(credentials); break;
      case 'docker': result = await testDocker(credentials); break;
      case 'vercel': result = await testVercel(credentials); break;
      case 'netlify': result = await testNetlify(credentials); break;
      case 'railway': result = await testRailway(credentials); break;
      case 'render': result = await testRender(credentials); break;
      case 'aws': result = await testAWS(credentials); break;
      case 'gcp': result = await testGCP(credentials); break;
      case 'digitalocean': result = await testDigitalOcean(credentials); break;
      case 'cloudflare': result = await testCloudflare(credentials); break;
      case 's3': result = await testS3(config, credentials); break;
      case 'slack': result = await testSlack(credentials); break;
      case 'discord': result = await testDiscord(credentials); break;
      case 'telegram': result = await testTelegram(credentials); break;
      case 'teams': result = await testTeams(credentials); break;
      case 'smtp': result = await testSmtp(config, credentials); break;
      case 'sendgrid': result = await testSendGrid(credentials); break;
      case 'twilio': result = await testTwilio(credentials); break;
      case 'openai': result = await testOpenAI(credentials); break;
      case 'anthropic': result = await testAnthropic(credentials); break;
      case 'google_ai': result = await testGoogleAI(credentials); break;
      case 'groq': result = await testGroq(credentials); break;
      case 'stripe': result = await testStripe(credentials); break;
      case 'razorpay': result = await testRazorpay(credentials); break;
      case 'notion': result = await testNotion(credentials); break;
      case 'linear': result = await testLinear(credentials); break;
      case 'jira': result = await testJira(credentials); break;
      case 'webhook': result = await testWebhook(credentials); break;
      case 'ssh': result = await testSSH(credentials); break;
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

// ─── Additional testers for the expanded integration catalog ─────

const fetchJson = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeoutMs || 10000) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
};

async function testGitLab(config, creds) {
  if (!creds?.token) throw new Error('Token required');
  const base = (config?.url || 'https://gitlab.com').replace(/\/$/, '');
  const { ok, status, data } = await fetchJson(`${base}/api/v4/user`, {
    headers: { 'PRIVATE-TOKEN': creds.token },
  });
  if (!ok) throw new Error(`GitLab ${status}`);
  return { ok: true, metadata: { username: data.username, name: data.name, id: data.id } };
}

async function testBitbucket(creds) {
  if (!creds?.username || !creds?.appPassword) throw new Error('Username and app password required');
  const basic = Buffer.from(`${creds.username}:${creds.appPassword}`).toString('base64');
  const { ok, status, data } = await fetchJson('https://api.bitbucket.org/2.0/user', {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!ok) throw new Error(`Bitbucket ${status}`);
  return { ok: true, metadata: { username: data.username, uuid: data.uuid } };
}

async function testFirebase(creds) {
  if (!creds?.serviceAccountJson) throw new Error('Service account JSON required');
  try {
    const parsed = typeof creds.serviceAccountJson === 'string'
      ? JSON.parse(creds.serviceAccountJson) : creds.serviceAccountJson;
    if (!parsed.project_id) throw new Error('Invalid service account JSON');
    return { ok: true, metadata: { projectId: parsed.project_id, clientEmail: parsed.client_email } };
  } catch (err) {
    throw new Error(`Firebase: ${err.message}`);
  }
}

async function testMongoDB(creds) {
  if (!creds?.connectionString) throw new Error('Connection string required');
  if (!/^mongodb(\+srv)?:\/\//.test(creds.connectionString)) throw new Error('Invalid MongoDB URI');
  return { ok: true, metadata: { host: creds.connectionString.split('@')[1]?.split('/')[0] || 'unknown' } };
}

async function testGenericHost(creds) {
  if (!creds?.host) throw new Error('Host required');
  return { ok: true, metadata: { host: creds.host } };
}

async function testPostgresConn(creds) {
  if (!creds?.connectionString) throw new Error('Connection string required');
  if (!/^postgres(ql)?:\/\//.test(creds.connectionString)) throw new Error('Invalid Postgres URI');
  return { ok: true, metadata: { host: creds.connectionString.split('@')[1]?.split('/')[0] || 'unknown' } };
}

async function testRedis(creds) {
  if (!creds?.url) throw new Error('URL required');
  if (!/^rediss?:\/\//.test(creds.url)) throw new Error('Invalid Redis URL');
  return { ok: true, metadata: { host: creds.url.split('@').pop().split('/')[0] } };
}

async function testVercel(creds) {
  if (!creds?.token) throw new Error('Token required');
  const { ok, status, data } = await fetchJson('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!ok) throw new Error(`Vercel ${status}`);
  return { ok: true, metadata: { username: data.user?.username, email: data.user?.email } };
}

async function testNetlify(creds) {
  if (!creds?.token) throw new Error('Token required');
  const { ok, status, data } = await fetchJson('https://api.netlify.com/api/v1/user', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!ok) throw new Error(`Netlify ${status}`);
  return { ok: true, metadata: { email: data.email, fullName: data.full_name } };
}

async function testRailway(creds) {
  if (!creds?.token) throw new Error('Token required');
  // Railway uses GraphQL; a simple authenticated ping
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ me { id name email } }' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Railway ${res.status}`);
  const { data } = await res.json();
  return { ok: true, metadata: { name: data?.me?.name, email: data?.me?.email } };
}

async function testRender(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const { ok, status, data } = await fetchJson('https://api.render.com/v1/owners?limit=1', {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!ok) throw new Error(`Render ${status}`);
  return { ok: true, metadata: { owners: Array.isArray(data) ? data.length : 0 } };
}

async function testAWS(creds) {
  if (!creds?.accessKeyId || !creds?.secretAccessKey) throw new Error('Access keys required');
  if (!/^AKIA|^ASIA/.test(creds.accessKeyId)) console.warn('AWS key format unusual');
  return { ok: true, metadata: { accessKeyId: creds.accessKeyId.slice(0, 8) + '...', region: creds.region } };
}

async function testGCP(creds) {
  if (!creds?.serviceAccountJson) throw new Error('Service account JSON required');
  try {
    const parsed = typeof creds.serviceAccountJson === 'string'
      ? JSON.parse(creds.serviceAccountJson) : creds.serviceAccountJson;
    return { ok: true, metadata: { projectId: parsed.project_id, clientEmail: parsed.client_email } };
  } catch (err) {
    throw new Error(`GCP: ${err.message}`);
  }
}

async function testDigitalOcean(creds) {
  if (!creds?.token) throw new Error('Token required');
  const { ok, status, data } = await fetchJson('https://api.digitalocean.com/v2/account', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!ok) throw new Error(`DigitalOcean ${status}`);
  return { ok: true, metadata: { email: data.account?.email, status: data.account?.status } };
}

async function testS3(config, creds) {
  if (!creds?.accessKeyId || !creds?.secretAccessKey) throw new Error('Access keys required');
  if (!config?.bucket) throw new Error('Bucket required');
  return { ok: true, metadata: { bucket: config.bucket, region: config.region, endpoint: config.endpoint || 'aws' } };
}

async function testTelegram(creds) {
  if (!creds?.botToken) throw new Error('Bot token required');
  const { ok, status, data } = await fetchJson(`https://api.telegram.org/bot${creds.botToken}/getMe`);
  if (!ok || !data.ok) throw new Error(`Telegram ${status}: ${data.description || 'failed'}`);
  return { ok: true, metadata: { botName: data.result?.username, chatId: creds.chatId } };
}

async function testTeams(creds) {
  if (!creds?.webhookUrl) throw new Error('Webhook URL required');
  const res = await fetch(creds.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'VPC OS integration test — connection successful.' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Teams ${res.status}`);
  return { ok: true, metadata: {} };
}

async function testSendGrid(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const { ok, status, data } = await fetchJson('https://api.sendgrid.com/v3/user/profile', {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!ok) throw new Error(`SendGrid ${status}`);
  return { ok: true, metadata: { email: data.email, first_name: data.first_name } };
}

async function testTwilio(creds) {
  if (!creds?.accountSid || !creds?.authToken) throw new Error('Account SID and auth token required');
  const basic = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  const { ok, status, data } = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!ok) throw new Error(`Twilio ${status}`);
  return { ok: true, metadata: { friendlyName: data.friendly_name, status: data.status } };
}

async function testOpenAI(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const { ok, status, data } = await fetchJson('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      ...(creds.organization ? { 'OpenAI-Organization': creds.organization } : {}),
    },
  });
  if (!ok) throw new Error(`OpenAI ${status}`);
  return { ok: true, metadata: { models: (data.data || []).length } };
}

async function testAnthropic(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  // Anthropic doesn't expose a plain /models endpoint requiring version header; use a cheap HEAD-style
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': creds.apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return { ok: true, metadata: { models: (body.data || []).length } };
}

async function testGoogleAI(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const { ok, status, data } = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(creds.apiKey)}`
  );
  if (!ok) throw new Error(`Google AI ${status}: ${data.error?.message || ''}`);
  return { ok: true, metadata: { models: (data.models || []).length } };
}

async function testGroq(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const { ok, status, data } = await fetchJson('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!ok) throw new Error(`Groq ${status}`);
  return { ok: true, metadata: { models: (data.data || []).length } };
}

async function testStripe(creds) {
  if (!creds?.secretKey) throw new Error('Secret key required');
  const { ok, status, data } = await fetchJson('https://api.stripe.com/v1/account', {
    headers: { Authorization: `Bearer ${creds.secretKey}` },
  });
  if (!ok) throw new Error(`Stripe ${status}`);
  return { ok: true, metadata: { email: data.email, country: data.country, livemode: creds.secretKey.startsWith('sk_live_') } };
}

async function testRazorpay(creds) {
  if (!creds?.keyId || !creds?.keySecret) throw new Error('Key ID and secret required');
  const basic = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64');
  const { ok, status } = await fetchJson('https://api.razorpay.com/v1/payments?count=1', {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!ok) throw new Error(`Razorpay ${status}`);
  return { ok: true, metadata: { keyId: creds.keyId } };
}

async function testNotion(creds) {
  if (!creds?.token) throw new Error('Token required');
  const { ok, status, data } = await fetchJson('https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${creds.token}`, 'Notion-Version': '2022-06-28' },
  });
  if (!ok) throw new Error(`Notion ${status}`);
  return { ok: true, metadata: { name: data.name, type: data.type } };
}

async function testLinear(creds) {
  if (!creds?.apiKey) throw new Error('API key required');
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: creds.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ viewer { id name email } }' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Linear ${res.status}`);
  const { data } = await res.json();
  return { ok: true, metadata: { name: data?.viewer?.name, email: data?.viewer?.email } };
}

async function testJira(creds) {
  if (!creds?.url || !creds?.email || !creds?.apiToken) throw new Error('URL, email, token required');
  const basic = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
  const base = creds.url.replace(/\/$/, '');
  const { ok, status, data } = await fetchJson(`${base}/rest/api/3/myself`, {
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
  });
  if (!ok) throw new Error(`Jira ${status}`);
  return { ok: true, metadata: { accountId: data.accountId, email: data.emailAddress } };
}

async function testWebhook(creds) {
  if (!creds?.url) throw new Error('URL required');
  const res = await fetch(creds.url, {
    method: creds.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(creds.bearer ? { Authorization: `Bearer ${creds.bearer}` } : {}),
    },
    body: JSON.stringify({ test: true, source: 'VPC integration test' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 204) throw new Error(`Webhook ${res.status}`);
  return { ok: true, metadata: { status: res.status } };
}

async function testSSH(creds) {
  if (!creds?.host || !creds?.username || !creds?.privateKey) throw new Error('Host, username, and private key required');
  // Basic TCP reachability check (full SSH handshake requires ssh2 lib)
  const net = require('net');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: creds.host, port: parseInt(creds.port) || 22, timeout: 10000 });
    socket.on('connect', () => {
      socket.destroy();
      resolve({ ok: true, metadata: { host: creds.host, port: creds.port || 22, user: creds.username } });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SSH port unreachable')); });
    socket.on('error', (err) => reject(new Error(`SSH: ${err.message}`)));
  });
}

module.exports = {
  INTEGRATION_TYPES,
  getAll,
  getById,
  getByType,
  getDefault,
  setDefault,
  create,
  update,
  remove,
  testConnection,
  getCredentials,
  resolveCredentials,
  recordUse,
  listUses,
};
