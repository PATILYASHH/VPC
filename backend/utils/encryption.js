const crypto = require('crypto');

const ENC_ALGO = 'aes-256-gcm';
const SALT = 'vpc-settings-salt';

// Versioned keys — newest first. Add new keys here without removing old ones;
// old blobs keep decrypting with their original version.
const KEYS = {
  1: crypto.scryptSync(process.env.JWT_SECRET || 'vpc-default-key', SALT, 32),
};
if (process.env.VPC_ENC_KEY_V2) {
  KEYS[2] = crypto.scryptSync(process.env.VPC_ENC_KEY_V2, SALT, 32);
}
const CURRENT_VERSION = KEYS[2] ? 2 : 1;

function encrypt(text, version = CURRENT_VERSION) {
  const key = KEYS[version];
  if (!key) throw new Error(`Unknown key version: ${version}`);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, key, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  // New format: v{N}:iv:tag:ct  (old format still accepted by decrypt)
  return `v${version}:${iv.toString('hex')}:${tag}:${enc}`;
}

function decrypt(data) {
  if (!data || typeof data !== 'string') return null;
  try {
    let parts = data.split(':');
    let version = 1;
    if (parts[0]?.startsWith('v')) {
      version = parseInt(parts[0].slice(1), 10);
      parts = parts.slice(1);
    }
    const key = KEYS[version];
    if (!key) return null;
    const [ivHex, tagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv(ENC_ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(encrypted, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return null; }
}

function currentKeyVersion() { return CURRENT_VERSION; }

function maskSecret(val) {
  if (!val || val.length < 16) return val ? '***' : '';
  return val.slice(0, 8) + '...' + val.slice(-4);
}

module.exports = { encrypt, decrypt, maskSecret, currentKeyVersion };
