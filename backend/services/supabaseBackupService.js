/**
 * Supabase backup destination — upload local pg_dump files and (optionally)
 * mirror data rows into a Supabase project on a fixed schedule.
 *
 * Auth: Supabase URL + service_role_key (encrypted at rest).
 * Transport: Supabase REST (for data) + Supabase Storage REST (for dump file).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { encrypt, decrypt, maskSecret } = require('../utils/encryption');
const backupService = require('./backupService');

// ─── low-level HTTP ───────────────────────────────────────────

function request(url, { method = 'GET', headers = {}, body, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(u, { method, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let data = text;
        try { data = JSON.parse(text); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, data, raw: buf });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Supabase request timed out')); });
    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) req.write(body);
      else if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ─── config helpers ───────────────────────────────────────────

function sanitizeConfig(dest) {
  const cfg = { ...(dest.config || {}) };
  if (cfg.service_role_key) cfg.service_role_key = maskSecret(cfg.service_role_key);
  return { ...dest, config: cfg };
}

function resolveKey(dest) {
  const cfg = dest.config || {};
  const enc = cfg.service_role_key_enc;
  if (!enc) return null;
  return decrypt(enc);
}

// ─── Supabase operations ──────────────────────────────────────

async function testConnection({ url, service_role_key }) {
  if (!url || !service_role_key) throw new Error('url and service_role_key required');
  const clean = url.replace(/\/+$/, '');

  // A cheap, authed call: GET /rest/v1/ returns OpenAPI schema
  const res = await request(`${clean}/rest/v1/`, {
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
    },
    timeout: 15000,
  });

  if (res.status >= 400) {
    throw new Error(`Supabase test failed (HTTP ${res.status}): ${typeof res.data === 'string' ? res.data.slice(0, 200) : (res.data?.message || 'unknown')}`);
  }
  return { ok: true };
}

async function ensureBucket({ url, service_role_key, bucket }) {
  const clean = url.replace(/\/+$/, '');

  // GET bucket; create if missing
  const head = await request(`${clean}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
    },
    timeout: 15000,
  });
  if (head.status === 200) return;

  const create = await request(`${clean}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
      'Content-Type': 'application/json',
    },
    body: { id: bucket, name: bucket, public: false },
    timeout: 15000,
  });
  if (create.status >= 400) {
    throw new Error(`Failed to create bucket '${bucket}': ${create.data?.message || create.status}`);
  }
}

async function uploadFile({ url, service_role_key, bucket, remotePath, filePath }) {
  const clean = url.replace(/\/+$/, '');
  const body = fs.readFileSync(filePath);

  const res = await request(`${clean}/storage/v1/object/${encodeURIComponent(bucket)}/${remotePath}`, {
    method: 'POST',
    headers: {
      apikey: service_role_key,
      Authorization: `Bearer ${service_role_key}`,
      'Content-Type': 'application/octet-stream',
      'x-upsert': 'true',
      'Cache-Control': '3600',
      'Content-Length': String(body.length),
    },
    body,
    timeout: 600000,
  });

  if (res.status >= 400) {
    throw new Error(`Upload failed (HTTP ${res.status}): ${res.data?.message || res.data?.error || 'unknown'}`);
  }
  return { bytes: body.length, remotePath };
}

// ─── run a scheduled push ─────────────────────────────────────

async function runDestination(pool, destinationId, { initiatedBy, reuseBackupId } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM vpc_backup_destinations WHERE id = $1',
    [destinationId]
  );
  if (rows.length === 0) throw new Error('Destination not found');
  const dest = rows[0];

  const key = resolveKey(dest);
  if (!key) throw new Error('No service role key stored for this destination');

  const cfg = dest.config || {};
  const bucket = cfg.bucket || 'vpc-backups';

  // Mark running
  await pool.query(
    `UPDATE vpc_backup_destinations SET last_run_status = 'running', last_run_error = NULL WHERE id = $1`,
    [destinationId]
  );

  const runInsert = await pool.query(
    `INSERT INTO vpc_backup_destination_runs (destination_id, status) VALUES ($1, 'running') RETURNING id`,
    [destinationId]
  );
  const runId = runInsert.rows[0].id;
  const startedMs = Date.now();

  try {
    // 1. Produce a fresh backup (or reuse provided one)
    let backup;
    if (reuseBackupId) {
      const r = await pool.query('SELECT * FROM backups WHERE id = $1', [reuseBackupId]);
      if (r.rows.length === 0) throw new Error('reuseBackupId not found');
      backup = r.rows[0];
    } else {
      backup = await backupService.runBackup(pool, {
        backupType: 'full',
        initiatedBy: initiatedBy || dest.created_by,
        notes: `Scheduled push → supabase destination "${dest.name}"`,
      });
      if (backup.status !== 'completed') {
        throw new Error(`pg_dump failed: ${backup.error_message || 'unknown'}`);
      }
    }

    if (!backup.file_path || !fs.existsSync(backup.file_path)) {
      throw new Error('Backup file missing on disk');
    }

    // 2. Ensure bucket exists, upload the dump
    await ensureBucket({ url: cfg.url, service_role_key: key, bucket });
    const remotePath = `${new Date().toISOString().slice(0, 10)}/${backup.filename}`;
    const upload = await uploadFile({
      url: cfg.url,
      service_role_key: key,
      bucket,
      remotePath,
      filePath: backup.file_path,
    });

    // 3. Update records
    const durationMs = Date.now() - startedMs;
    const nextRun = computeNextRun(dest);

    await pool.query(
      `UPDATE vpc_backup_destination_runs
       SET status='success', bytes_uploaded=$1, remote_path=$2, duration_ms=$3, completed_at=NOW(), backup_id=$4
       WHERE id=$5`,
      [upload.bytes, remotePath, durationMs, backup.id, runId]
    );

    await pool.query(
      `UPDATE vpc_backup_destinations
       SET last_run_at=NOW(), last_run_status='success', last_run_error=NULL,
           last_run_bytes=$1, next_run_at=$2, updated_at=NOW()
       WHERE id=$3`,
      [upload.bytes, nextRun, destinationId]
    );

    return {
      ok: true,
      destination_id: destinationId,
      backup_id: backup.id,
      remote_path: remotePath,
      bytes: upload.bytes,
      duration_ms: durationMs,
      next_run_at: nextRun,
    };
  } catch (err) {
    const durationMs = Date.now() - startedMs;
    await pool.query(
      `UPDATE vpc_backup_destination_runs
       SET status='failed', error_message=$1, duration_ms=$2, completed_at=NOW()
       WHERE id=$3`,
      [err.message, durationMs, runId]
    );
    await pool.query(
      `UPDATE vpc_backup_destinations
       SET last_run_at=NOW(), last_run_status='failed', last_run_error=$1,
           next_run_at=$2, updated_at=NOW()
       WHERE id=$3`,
      [err.message, computeNextRun(dest), destinationId]
    );
    throw err;
  }
}

// ─── scheduling helpers ───────────────────────────────────────

function computeNextRun(dest) {
  const now = Date.now();
  if (dest.interval_minutes && dest.interval_minutes > 0) {
    return new Date(now + dest.interval_minutes * 60 * 1000);
  }
  // Default: daily at next midnight UTC if nothing set
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

async function dueDestinations(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM vpc_backup_destinations
     WHERE enabled = true
       AND (next_run_at IS NULL OR next_run_at <= NOW())
       AND COALESCE(last_run_status, '') <> 'running'`
  );
  return rows;
}

module.exports = {
  sanitizeConfig,
  testConnection,
  runDestination,
  dueDestinations,
  computeNextRun,
  encryptKey: encrypt,
};
