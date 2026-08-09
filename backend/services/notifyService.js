const crypto = require('crypto');

// ── Slug helper (mirrors dbService.generateSlug) ──────────────────
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

// ── Projects ────────────────────────────────────────────────────
async function getProjects(pool) {
  const { rows } = await pool.query(
    `SELECT p.*,
       (SELECT COUNT(*) FROM notify_devices d WHERE d.project_id = p.id AND d.status = 'active') AS device_count
     FROM notify_projects p
     WHERE p.status != 'deleted'
     ORDER BY p.created_at DESC`
  );
  return rows;
}

async function getProject(pool, id) {
  const { rows } = await pool.query(
    `SELECT * FROM notify_projects WHERE id = $1 AND status != 'deleted'`,
    [id]
  );
  return rows[0] || null;
}

async function getProjectStats(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM notify_devices WHERE project_id = $1 AND status = 'active') AS active_devices,
       (SELECT COUNT(*) FROM notify_messages WHERE project_id = $1) AS total_messages,
       (SELECT COUNT(*) FROM notify_deliveries WHERE project_id = $1 AND status = 'delivered') AS total_delivered,
       (SELECT COUNT(*) FROM notify_deliveries WHERE project_id = $1 AND status = 'failed') AS total_failed,
       (SELECT COUNT(*) FROM notify_deliveries WHERE project_id = $1 AND status IN ('queued','sent')) AS total_pending`,
    [projectId]
  );
  return rows[0];
}

async function createProject(pool, { name, slug, androidPackageName, maxDevices, maxQueuePerDevice, defaultTtlSeconds, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO notify_projects (name, slug, android_package_name, max_devices, max_queue_per_device, default_ttl_seconds, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name, slug, androidPackageName || null, maxDevices || 10000, maxQueuePerDevice || 100, defaultTtlSeconds || 259200, createdBy || null]
  );
  return rows[0];
}

async function updateProjectSettings(pool, id, { name, androidPackageName, maxDevices, maxQueuePerDevice, defaultTtlSeconds }) {
  const { rows } = await pool.query(
    `UPDATE notify_projects SET
       name = COALESCE($2, name),
       android_package_name = COALESCE($3, android_package_name),
       max_devices = COALESCE($4, max_devices),
       max_queue_per_device = COALESCE($5, max_queue_per_device),
       default_ttl_seconds = COALESCE($6, default_ttl_seconds),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, name || null, androidPackageName || null, maxDevices || null, maxQueuePerDevice || null, defaultTtlSeconds || null]
  );
  return rows[0] || null;
}

async function deleteProject(pool, id) {
  await pool.query(`UPDATE notify_projects SET status = 'deleted', updated_at = NOW() WHERE id = $1`, [id]);
  return { deleted: true };
}

// ── API key encryption (mirrors dbService's AES-256-GCM pattern) ──
const KEY_ENC_ALGO = 'aes-256-gcm';
const KEY_ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'notify-default-key', 'notify-key-salt', 32);

function encryptApiKey(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(KEY_ENC_ALGO, KEY_ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decryptApiKey(data) {
  try {
    const [ivHex, tagHex, encrypted] = data.split(':');
    const decipher = crypto.createDecipheriv(KEY_ENC_ALGO, KEY_ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

// ── API keys ────────────────────────────────────────────────────
function generateApiKey(role) {
  const prefix = role === 'server' ? 'notify_svc_' : 'notify_';
  const rawKey = prefix + crypto.randomBytes(32).toString('hex');
  const keyPrefix = rawKey.slice(prefix.length, prefix.length + 12);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, keyPrefix, keyHash };
}

async function getApiKeys(pool, projectId) {
  const { rows } = await pool.query(
    `SELECT id, project_id, name, key_prefix, role, is_active, encrypted_key, created_at
     FROM notify_api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map((row) => ({
    ...row,
    api_key: row.encrypted_key ? decryptApiKey(row.encrypted_key) : null,
    encrypted_key: undefined,
  }));
}

async function createApiKey(pool, projectId, { name, role }) {
  const { rawKey, keyPrefix, keyHash } = generateApiKey(role || 'client');
  const encrypted = encryptApiKey(rawKey);
  const { rows } = await pool.query(
    `INSERT INTO notify_api_keys (project_id, name, key_prefix, key_hash, role, encrypted_key)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, key_prefix, role, created_at`,
    [projectId, name, keyPrefix, keyHash, role || 'client', encrypted]
  );
  return { ...rows[0], api_key: rawKey };
}

// Auto-create default client + server keys if they don't exist yet
async function ensureDefaultKeys(pool, projectId) {
  const existing = await getApiKeys(pool, projectId);
  const activeClient = existing.find((k) => k.role === 'client' && k.is_active);
  const activeServer = existing.find((k) => k.role === 'server' && k.is_active);

  if (!activeClient) await createApiKey(pool, projectId, { name: 'client key', role: 'client' });
  if (!activeServer) await createApiKey(pool, projectId, { name: 'server key', role: 'server' });

  return getApiKeys(pool, projectId);
}

async function regenerateApiKey(pool, projectId, role) {
  await pool.query(
    `UPDATE notify_api_keys SET is_active = false WHERE project_id = $1 AND role = $2 AND is_active = true`,
    [projectId, role]
  );
  const name = role === 'server' ? 'server key' : 'client key';
  return createApiKey(pool, projectId, { name, role });
}

async function revokeApiKey(pool, keyId) {
  const { rowCount } = await pool.query(`UPDATE notify_api_keys SET is_active = false WHERE id = $1`, [keyId]);
  return { revoked: rowCount > 0 };
}

async function findProjectByApiKeyHash(pool, keyHash) {
  const { rows } = await pool.query(
    `SELECT nak.id AS api_key_id, nak.role, np.*
     FROM notify_api_keys nak
     JOIN notify_projects np ON np.id = nak.project_id
     WHERE nak.key_hash = $1 AND nak.is_active = true AND np.status = 'active'`,
    [keyHash]
  );
  return rows[0] || null;
}

// ── Devices ─────────────────────────────────────────────────────
async function registerDevice(pool, project, { deviceId, platform, appVersion, sdkVersion, osVersion, deviceModel }) {
  if (!deviceId) throw new Error('device_id is required');

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM notify_devices WHERE project_id = $1 AND status = 'active'`,
    [project.id]
  );
  const existing = await pool.query(
    `SELECT id FROM notify_devices WHERE project_id = $1 AND device_id = $2`,
    [project.id, deviceId]
  );
  if (existing.rows.length === 0 && parseInt(countRows[0].count) >= project.max_devices) {
    const err = new Error(`Project has reached its device limit (${project.max_devices})`);
    err.code = 'DEVICE_LIMIT_REACHED';
    throw err;
  }

  const pushToken = 'ntfy_' + crypto.randomBytes(24).toString('hex');
  const { rows } = await pool.query(
    `INSERT INTO notify_devices (project_id, device_id, platform, app_version, sdk_version, os_version, device_model, push_token, status, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW())
     ON CONFLICT (project_id, device_id) DO UPDATE SET
       platform = EXCLUDED.platform,
       app_version = EXCLUDED.app_version,
       sdk_version = EXCLUDED.sdk_version,
       os_version = EXCLUDED.os_version,
       device_model = EXCLUDED.device_model,
       status = 'active',
       last_seen_at = NOW()
     RETURNING *`,
    [project.id, deviceId, platform || 'android', appVersion || null, sdkVersion || null, osVersion || null, deviceModel || null, pushToken]
  );
  return rows[0];
}

async function getDevices(pool, projectId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM notify_devices WHERE project_id = $1 ORDER BY last_seen_at DESC NULLS LAST LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM notify_devices WHERE project_id = $1`,
    [projectId]
  );
  return { devices: rows, total: parseInt(countRows[0].count) };
}

async function heartbeatDevice(pool, projectId, deviceId) {
  const { rows } = await pool.query(
    `UPDATE notify_devices SET last_seen_at = NOW(), status = 'active'
     WHERE project_id = $1 AND device_id = $2 RETURNING *`,
    [projectId, deviceId]
  );
  return rows[0] || null;
}

async function unregisterDevice(pool, projectId, deviceId) {
  const { rowCount } = await pool.query(
    `UPDATE notify_devices SET status = 'unregistered' WHERE project_id = $1 AND device_id = $2`,
    [projectId, deviceId]
  );
  return { unregistered: rowCount > 0 };
}

async function subscribeTopic(pool, projectId, deviceId, topic) {
  const { rows: deviceRows } = await pool.query(
    `SELECT id FROM notify_devices WHERE project_id = $1 AND device_id = $2`,
    [projectId, deviceId]
  );
  if (!deviceRows[0]) throw new Error('Device not found — register before subscribing');

  await pool.query(
    `INSERT INTO notify_topic_subscriptions (project_id, device_id, topic)
     VALUES ($1, $2, $3) ON CONFLICT (device_id, topic) DO NOTHING`,
    [projectId, deviceRows[0].id, topic]
  );
  return { subscribed: true, topic };
}

async function unsubscribeTopic(pool, projectId, deviceId, topic) {
  const { rows: deviceRows } = await pool.query(
    `SELECT id FROM notify_devices WHERE project_id = $1 AND device_id = $2`,
    [projectId, deviceId]
  );
  if (!deviceRows[0]) return { unsubscribed: false };

  const { rowCount } = await pool.query(
    `DELETE FROM notify_topic_subscriptions WHERE device_id = $1 AND topic = $2`,
    [deviceRows[0].id, topic]
  );
  return { unsubscribed: rowCount > 0 };
}

// ── Messages / send ─────────────────────────────────────────────
// M1 scope: resolves targets and writes queued delivery rows. Rows stay
// 'queued' until the WebSocket gateway (M2) exists to actually push them.
async function sendMessage(pool, project, apiKeyId, { target, title, body, data, priority, ttlSeconds, collapseKey }) {
  if (!target || !target.type) throw new Error('target.type is required (device | topic | broadcast)');
  if (!['device', 'topic', 'broadcast'].includes(target.type)) {
    throw new Error('target.type must be device, topic, or broadcast');
  }

  const ttl = ttlSeconds || project.default_ttl_seconds;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // Resolve target device row ids
  let deviceRows = [];
  if (target.type === 'device') {
    if (!target.device_id) throw new Error('target.device_id is required for target.type=device');
    const { rows } = await pool.query(
      `SELECT id FROM notify_devices WHERE project_id = $1 AND device_id = $2 AND status = 'active'`,
      [project.id, target.device_id]
    );
    deviceRows = rows;
  } else if (target.type === 'topic') {
    if (!target.topic) throw new Error('target.topic is required for target.type=topic');
    const { rows } = await pool.query(
      `SELECT d.id FROM notify_devices d
       JOIN notify_topic_subscriptions s ON s.device_id = d.id
       WHERE d.project_id = $1 AND s.topic = $2 AND d.status = 'active'`,
      [project.id, target.topic]
    );
    deviceRows = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT id FROM notify_devices WHERE project_id = $1 AND status = 'active'`,
      [project.id]
    );
    deviceRows = rows;
  }

  const { rows: msgRows } = await pool.query(
    `INSERT INTO notify_messages
       (project_id, target_type, target_value, title, body, data, priority, ttl_seconds, collapse_key, created_by_key_id, status, target_device_count, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'processing', $11, $12)
     RETURNING *`,
    [
      project.id, target.type, target.device_id || target.topic || null,
      title || null, body || null, JSON.stringify(data || {}),
      priority === 'high' ? 'high' : 'normal', ttl, collapseKey || null,
      apiKeyId || null, deviceRows.length, expiresAt,
    ]
  );
  const message = msgRows[0];

  if (deviceRows.length > 0) {
    const insertValues = [];
    const params = [message.id, project.id, expiresAt];
    let paramIdx = 4;
    for (const d of deviceRows) {
      insertValues.push(`($1, $${paramIdx}, $2, $3)`);
      params.push(d.id);
      paramIdx += 1;
    }
    await pool.query(
      `INSERT INTO notify_deliveries (message_id, device_id, project_id, expires_at)
       VALUES ${insertValues.join(', ')}`,
      params
    );
  }

  await pool.query(
    `UPDATE notify_messages SET status = 'completed' WHERE id = $1`,
    [message.id]
  );

  return { ...message, status: 'completed' };
}

async function getMessage(pool, projectId, messageId) {
  const { rows } = await pool.query(
    `SELECT m.*,
       (SELECT COUNT(*) FROM notify_deliveries WHERE message_id = m.id AND status = 'delivered') AS delivered_count_live,
       (SELECT COUNT(*) FROM notify_deliveries WHERE message_id = m.id AND status = 'failed') AS failed_count_live,
       (SELECT COUNT(*) FROM notify_deliveries WHERE message_id = m.id AND status IN ('queued','sent')) AS pending_count
     FROM notify_messages m WHERE m.id = $1 AND m.project_id = $2`,
    [messageId, projectId]
  );
  return rows[0] || null;
}

async function getMessageDeliveries(pool, messageId, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT dl.*, dv.device_id AS device_external_id, dv.device_model
     FROM notify_deliveries dl
     JOIN notify_devices dv ON dv.id = dl.device_id
     WHERE dl.message_id = $1
     ORDER BY dl.created_at DESC LIMIT $2 OFFSET $3`,
    [messageId, limit, offset]
  );
  return rows;
}

async function getMessages(pool, projectId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM notify_messages WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [projectId, limit, offset]
  );
  return rows;
}

module.exports = {
  generateSlug,
  getProjects,
  getProject,
  getProjectStats,
  createProject,
  updateProjectSettings,
  deleteProject,
  getApiKeys,
  createApiKey,
  ensureDefaultKeys,
  regenerateApiKey,
  revokeApiKey,
  findProjectByApiKeyHash,
  registerDevice,
  getDevices,
  heartbeatDevice,
  unregisterDevice,
  subscribeTopic,
  unsubscribeTopic,
  sendMessage,
  getMessage,
  getMessageDeliveries,
  getMessages,
};
