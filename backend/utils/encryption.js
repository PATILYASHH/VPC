const crypto = require('crypto');

const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'vpc-default-key', 'vpc-settings-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENC_ALGO, ENC_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${enc}`;
}

function decrypt(data) {
  try {
    const [ivHex, tagHex, encrypted] = data.split(':');
    const decipher = crypto.createDecipheriv(ENC_ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let dec = decipher.update(encrypted, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return null; }
}

function maskSecret(val) {
  if (!val || val.length < 16) return val ? '***' : '';
  return val.slice(0, 8) + '...' + val.slice(-4);
}

module.exports = { encrypt, decrypt, maskSecret };
