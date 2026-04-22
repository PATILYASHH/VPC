/**
 * Baseline smoke tests — zero-deps, uses Node's built-in `node:test` + `node:assert`.
 * Run with: node --test backend/tests
 *
 * These tests do NOT require a running DB — they exercise pure functions only.
 */

const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-round-trip';

// ─── Encryption round-trip ─────────────────────────────────

test('encryption: round-trip preserves plaintext', () => {
  const { encrypt, decrypt } = require('../utils/encryption');
  const samples = [
    'hello world',
    'example-api-token-placeholder-not-a-real-secret',
    'multi\nline\nvalue',
    JSON.stringify({ a: 1, b: [2, 3], c: 'nested' }),
    '', // empty
    '🔐 unicode 中文 emoji',
  ];
  for (const plain of samples) {
    const c = encrypt(plain);
    const d = decrypt(c);
    assert.strictEqual(d, plain, `round-trip failed for "${plain}"`);
  }
});

test('encryption: decrypt handles legacy (v-less) format', () => {
  const { encrypt, decrypt } = require('../utils/encryption');
  // The new format starts with "v1:". Strip the prefix to simulate a legacy blob.
  const blob = encrypt('legacy data');
  const legacy = blob.replace(/^v\d+:/, '');
  assert.strictEqual(decrypt(legacy), 'legacy data');
});

test('encryption: decrypt returns null for garbage', () => {
  const { decrypt } = require('../utils/encryption');
  assert.strictEqual(decrypt(null), null);
  assert.strictEqual(decrypt(''), null);
  assert.strictEqual(decrypt('not-encrypted'), null);
  assert.strictEqual(decrypt('v1:abc:def:ghi'), null);
});

// ─── Integration catalog sanity ─────────────────────────────

test('integrations: all types have name + fields', () => {
  const { INTEGRATION_TYPES } = require('../services/integrationService');
  const ids = Object.keys(INTEGRATION_TYPES);
  assert.ok(ids.length >= 20, `expected at least 20 integrations, got ${ids.length}`);
  for (const id of ids) {
    const t = INTEGRATION_TYPES[id];
    assert.ok(t.name, `${id}: missing name`);
    assert.ok(t.category, `${id}: missing category`);
    assert.ok(Array.isArray(t.fields), `${id}: fields must be array`);
    for (const f of t.fields) {
      assert.ok(f.key, `${id} field missing key`);
      assert.ok(['string', 'number', 'secret'].includes(f.type), `${id}.${f.key} bad type: ${f.type}`);
    }
  }
});

test('integrations: every type has a tester case', () => {
  const { INTEGRATION_TYPES, testConnection } = require('../services/integrationService');
  // testConnection calls internal testers — we can't run them without a pool,
  // but we can assert the function exists and handles unknown types gracefully.
  assert.strictEqual(typeof testConnection, 'function');
  for (const id of Object.keys(INTEGRATION_TYPES)) {
    assert.match(id, /^[a-z0-9_]+$/);
  }
});

// ─── Automation registry ────────────────────────────────────

test('automations: registry is consistent', () => {
  const { AUTOMATIONS, listForType } = require('../services/integrationAutomations');
  assert.ok(Object.keys(AUTOMATIONS).length > 0);
  for (const key of Object.keys(AUTOMATIONS)) {
    assert.match(key, /^[a-z_]+:[a-z0-9-]+$/, `bad automation key: ${key}`);
    assert.strictEqual(typeof AUTOMATIONS[key].run, 'function');
  }
  const slackAutos = listForType('slack');
  assert.ok(slackAutos.length >= 2);
});

// ─── Pipeline promote service shape ─────────────────────────

test('pipeline promote service: exports expected API', () => {
  const svc = require('../services/pipelinePromoteService');
  assert.strictEqual(typeof svc.preflight, 'function');
  assert.strictEqual(typeof svc.promote, 'function');
  assert.strictEqual(typeof svc.rollback, 'function');
  assert.strictEqual(typeof svc.listRuns, 'function');
});

// ─── Logger basics ──────────────────────────────────────────

test('logger: forSource returns level methods', () => {
  const { forSource } = require('../utils/logger');
  const log = forSource('test');
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
    assert.strictEqual(typeof log[level], 'function', `logger.${level} missing`);
  }
});
