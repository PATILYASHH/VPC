#!/usr/bin/env node
/**
 * Re-encrypt all secret blobs with the current key version.
 *
 * Usage:
 *   VPC_ENC_KEY_V2=<new secret> node backend/scripts/rekey.js
 *
 * Safe to run repeatedly — blobs already on the current version are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { encrypt, decrypt, currentKeyVersion } = require('../utils/encryption');

async function run() {
  const target = currentKeyVersion();
  console.log(`[rekey] target version: v${target}`);

  const { rows } = await pool.query(
    `SELECT key, value, enc_key_version FROM vpc_settings WHERE is_secret = TRUE AND (enc_key_version IS NULL OR enc_key_version < $1)`,
    [target]
  );
  console.log(`[rekey] found ${rows.length} blobs to re-encrypt`);

  let ok = 0, fail = 0;
  for (const row of rows) {
    const plain = decrypt(row.value);
    if (plain === null) {
      console.warn(`[rekey] skip (decrypt failed): ${row.key}`);
      fail++;
      continue;
    }
    const rewrapped = encrypt(plain, target);
    await pool.query(
      'UPDATE vpc_settings SET value = $1, enc_key_version = $2, updated_at = NOW() WHERE key = $3',
      [rewrapped, target, row.key]
    );
    ok++;
  }

  console.log(`[rekey] done. success=${ok} failed=${fail}`);
  await pool.end();
}

run().catch(err => { console.error('[rekey] fatal:', err); process.exit(1); });
