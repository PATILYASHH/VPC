const crypto = require('crypto');
const bcrypt = require('bcryptjs');

function generateToken() {
  // Format: vpshub_<random 40 chars>
  const random = crypto.randomBytes(30).toString('hex').slice(0, 40);
  return `vpshub_${random}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getTokenPrefix(token) {
  return token.slice(0, 12);
}

// ─── Token CRUD ──────────────────────────────────────────────

async function createToken(pool, userId, name, scopes) {
  const token = generateToken();
  const hash = hashToken(token);
  const prefix = getTokenPrefix(token);

  const { rows } = await pool.query(
    `INSERT INTO vpshub_tokens (user_id, name, token_hash, token_prefix, scopes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, token_prefix, scopes, created_at`,
    [userId, name, hash, prefix, JSON.stringify(scopes || ['repo'])]
  );

  // Return the plain token only on creation (never stored)
  return { ...rows[0], token };
}

async function listTokens(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, name, token_prefix, scopes, last_used_at, created_at
     FROM vpshub_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function revokeToken(pool, tokenId, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM vpshub_tokens WHERE id = $1 AND user_id = $2',
    [tokenId, userId]
  );
  return rowCount > 0;
}

// ─── Git HTTP Authentication ─────────────────────────────────

async function authenticateGitRequest(pool, authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
  const colonIndex = decoded.indexOf(':');
  if (colonIndex === -1) return null;

  const username = decoded.slice(0, colonIndex);
  const password = decoded.slice(colonIndex + 1);

  // Password is the PAT token
  const tokenHash = hashToken(password);

  const { rows } = await pool.query(
    `SELECT t.id as token_id, t.user_id, t.scopes,
            a.id as admin_id, a.username, a.is_active
     FROM vpshub_tokens t
     JOIN vpc_admins a ON a.id = t.user_id
     WHERE t.token_hash = $1 AND a.username = $2 AND a.is_active = true`,
    [tokenHash, username]
  );

  if (rows.length === 0) return null;

  const result = rows[0];

  // Update last_used_at
  await pool.query(
    'UPDATE vpshub_tokens SET last_used_at = NOW() WHERE id = $1',
    [result.token_id]
  );

  return {
    userId: result.user_id,
    username: result.username,
    scopes: result.scopes,
  };
}

// ─── Access Control ──────────────────────────────────────────

async function checkRepoAccess(pool, userId, repoId, requiredPermission) {
  // Check if user is owner
  const { rows: ownerRows } = await pool.query(
    'SELECT id FROM vpshub_repositories WHERE id = $1 AND owner_id = $2',
    [repoId, userId]
  );
  if (ownerRows.length > 0) return true;

  // Check collaborator access
  const permLevels = { read: 1, write: 2, admin: 3 };
  const required = permLevels[requiredPermission] || 1;

  const { rows: collabRows } = await pool.query(
    'SELECT permission FROM vpshub_collaborators WHERE repo_id = $1 AND user_id = $2',
    [repoId, userId]
  );

  if (collabRows.length === 0) return false;
  return (permLevels[collabRows[0].permission] || 0) >= required;
}

module.exports = {
  generateToken,
  hashToken,
  createToken,
  listTokens,
  revokeToken,
  authenticateGitRequest,
  checkRepoAccess,
};
