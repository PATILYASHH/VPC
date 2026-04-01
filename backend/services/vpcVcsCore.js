/**
 * VPC VCS Core — Content-addressable object store
 *
 * Object types: blob, tree, commit
 * Hash: SHA-256
 * Storage: zlib-compressed files in objects/{hash[0:2]}/{hash[2:]}
 */

const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPOS_DIR = path.join(os.homedir(), 'vpshub-repos');

// ─── Object Hashing ──────────────────────────────────────────

/**
 * Hash an object: SHA-256 of "{type} {length}\0{content}"
 * @param {string} type - 'blob', 'tree', or 'commit'
 * @param {Buffer} content - raw content bytes
 * @returns {string} 64-char hex SHA-256 hash
 */
function hashObject(type, content) {
  const header = Buffer.from(`${type} ${content.length}\0`);
  const full = Buffer.concat([header, content]);
  return crypto.createHash('sha256').update(full).digest('hex');
}

/**
 * Serialize an object with its header for storage
 */
function serializeObject(type, content) {
  const header = Buffer.from(`${type} ${content.length}\0`);
  return Buffer.concat([header, content]);
}

// ─── Object Storage ──────────────────────────────────────────

function objectPath(repoPath, hash) {
  return path.join(repoPath, 'objects', hash.slice(0, 2), hash.slice(2));
}

function objectExists(repoPath, hash) {
  return fs.existsSync(objectPath(repoPath, hash));
}

/**
 * Write a compressed object to the store
 */
function writeObject(repoPath, hash, data) {
  const objPath = objectPath(repoPath, hash);
  const dir = path.dirname(objPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(objPath)) {
    const compressed = zlib.deflateSync(data);
    fs.writeFileSync(objPath, compressed);
  }
  return hash;
}

/**
 * Read and decompress an object from the store
 * @returns {{ type: string, content: Buffer }}
 */
function readObject(repoPath, hash) {
  const objPath = objectPath(repoPath, hash);
  if (!fs.existsSync(objPath)) {
    throw new Error(`Object not found: ${hash}`);
  }
  const compressed = fs.readFileSync(objPath);
  const data = zlib.inflateSync(compressed);

  // Parse header: "type length\0content"
  const nullIdx = data.indexOf(0);
  const header = data.slice(0, nullIdx).toString();
  const [type] = header.split(' ');
  const content = data.slice(nullIdx + 1);

  return { type, content };
}

/**
 * Read raw compressed bytes (for pack transfer)
 */
function readObjectRaw(repoPath, hash) {
  const objPath = objectPath(repoPath, hash);
  if (!fs.existsSync(objPath)) {
    throw new Error(`Object not found: ${hash}`);
  }
  return fs.readFileSync(objPath);
}

// ─── Blob Operations ─────────────────────────────────────────

/**
 * Create a blob object from file content
 * @param {Buffer|string} content
 * @returns {string} hash
 */
function createBlob(repoPath, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = hashObject('blob', buf);
  const serialized = serializeObject('blob', buf);
  writeObject(repoPath, hash, serialized);
  return hash;
}

/**
 * Read a blob's content
 * @returns {Buffer}
 */
function readBlob(repoPath, hash) {
  const obj = readObject(repoPath, hash);
  if (obj.type !== 'blob') {
    throw new Error(`Expected blob, got ${obj.type}`);
  }
  return obj.content;
}

// ─── Tree Operations ─────────────────────────────────────────

/**
 * Serialize tree entries into binary format:
 * Each entry: "<mode> <name>\0<32-byte-hash-binary>"
 *
 * @param {Array<{mode: string, name: string, hash: string}>} entries
 * @returns {Buffer}
 */
function serializeTreeEntries(entries) {
  // Sort lexicographically by name (directories get trailing / for sort, like Git)
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === '040000' ? a.name + '/' : a.name;
    const bName = b.mode === '040000' ? b.name + '/' : b.name;
    return aName.localeCompare(bName);
  });

  const parts = [];
  for (const entry of sorted) {
    const modeName = Buffer.from(`${entry.mode} ${entry.name}\0`);
    const hashBin = Buffer.from(entry.hash, 'hex');
    parts.push(modeName, hashBin);
  }
  return Buffer.concat(parts);
}

/**
 * Parse binary tree data back into entries
 * @param {Buffer} data - raw tree content (without header)
 * @returns {Array<{mode: string, name: string, hash: string}>}
 */
function parseTree(data) {
  const entries = [];
  let offset = 0;

  while (offset < data.length) {
    // Find the null byte separating "mode name" from hash
    const nullIdx = data.indexOf(0, offset);
    if (nullIdx === -1) break;

    const modeNameStr = data.slice(offset, nullIdx).toString();
    const spaceIdx = modeNameStr.indexOf(' ');
    const mode = modeNameStr.slice(0, spaceIdx);
    const name = modeNameStr.slice(spaceIdx + 1);

    // Next 32 bytes are the SHA-256 hash in binary
    const hashBin = data.slice(nullIdx + 1, nullIdx + 1 + 32);
    const hash = hashBin.toString('hex');

    entries.push({
      mode,
      name,
      hash,
      type: mode === '040000' ? 'tree' : 'blob',
    });

    offset = nullIdx + 1 + 32;
  }

  return entries;
}

/**
 * Create a tree object from entries
 * @param {Array<{mode: string, name: string, hash: string}>} entries
 * @returns {string} hash
 */
function createTree(repoPath, entries) {
  const content = serializeTreeEntries(entries);
  const hash = hashObject('tree', content);
  const serialized = serializeObject('tree', content);
  writeObject(repoPath, hash, serialized);
  return hash;
}

/**
 * Read and parse a tree object
 * @returns {Array<{mode: string, name: string, hash: string, type: string}>}
 */
function readTree(repoPath, hash) {
  const obj = readObject(repoPath, hash);
  if (obj.type !== 'tree') {
    throw new Error(`Expected tree, got ${obj.type}`);
  }
  return parseTree(obj.content);
}

// ─── Commit Operations ───────────────────────────────────────

/**
 * Serialize commit data into text format
 */
function serializeCommitContent({ tree, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message }) {
  const lines = [];
  lines.push(`tree ${tree}`);
  for (const parent of (parents || [])) {
    lines.push(`parent ${parent}`);
  }

  const aDate = authorDate || Math.floor(Date.now() / 1000);
  const cDate = committerDate || aDate;
  const tz = '+0000';

  lines.push(`author ${authorName} <${authorEmail}> ${aDate} ${tz}`);
  lines.push(`committer ${committerName || authorName} <${committerEmail || authorEmail}> ${cDate} ${tz}`);
  lines.push('');
  lines.push(message);

  return Buffer.from(lines.join('\n'));
}

/**
 * Parse commit content back into structured data
 * @param {Buffer} data
 * @returns {{ tree: string, parents: string[], authorName: string, authorEmail: string, authorDate: number, authorTz: string, committerName: string, committerEmail: string, committerDate: number, committerTz: string, message: string, body: string }}
 */
function parseCommit(data) {
  const text = data.toString();
  const blankIdx = text.indexOf('\n\n');
  const headerSection = text.slice(0, blankIdx);
  const messageSection = text.slice(blankIdx + 2);

  const headers = headerSection.split('\n');
  let tree = '';
  const parents = [];
  let authorName = '', authorEmail = '', authorDate = 0, authorTz = '+0000';
  let committerName = '', committerEmail = '', committerDate = 0, committerTz = '+0000';

  for (const line of headers) {
    if (line.startsWith('tree ')) {
      tree = line.slice(5);
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7));
    } else if (line.startsWith('author ')) {
      const match = line.match(/^author (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (match) {
        authorName = match[1];
        authorEmail = match[2];
        authorDate = parseInt(match[3]);
        authorTz = match[4];
      }
    } else if (line.startsWith('committer ')) {
      const match = line.match(/^committer (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (match) {
        committerName = match[1];
        committerEmail = match[2];
        committerDate = parseInt(match[3]);
        committerTz = match[4];
      }
    }
  }

  // Split message into subject and body
  const msgLines = messageSection.split('\n');
  const message = msgLines[0] || '';
  const body = msgLines.slice(1).join('\n').trim();

  return {
    tree, parents,
    authorName, authorEmail, authorDate, authorTz,
    committerName, committerEmail, committerDate, committerTz,
    message, body,
  };
}

/**
 * Create a commit object
 * @returns {string} commit hash
 */
function createCommit(repoPath, { tree, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message }) {
  const content = serializeCommitContent({
    tree, parents, authorName, authorEmail, authorDate,
    committerName, committerEmail, committerDate, message,
  });
  const hash = hashObject('commit', content);
  const serialized = serializeObject('commit', content);
  writeObject(repoPath, hash, serialized);
  return hash;
}

/**
 * Read and parse a commit object
 */
function readCommit(repoPath, hash) {
  const obj = readObject(repoPath, hash);
  if (obj.type !== 'commit') {
    throw new Error(`Expected commit, got ${obj.type}`);
  }
  return { hash, ...parseCommit(obj.content) };
}

// ─── Ref Management ──────────────────────────────────────────

/**
 * Read HEAD (may be symbolic ref or direct hash)
 * @returns {{ symbolic: boolean, ref?: string, hash?: string }}
 */
function readHead(repoPath) {
  const headPath = path.join(repoPath, 'HEAD');
  if (!fs.existsSync(headPath)) return { symbolic: true, ref: 'refs/heads/main' };

  const content = fs.readFileSync(headPath, 'utf8').trim();
  if (content.startsWith('ref: ')) {
    return { symbolic: true, ref: content.slice(5) };
  }
  return { symbolic: false, hash: content };
}

/**
 * Write HEAD
 */
function writeHead(repoPath, value) {
  const headPath = path.join(repoPath, 'HEAD');
  if (value.startsWith('refs/')) {
    fs.writeFileSync(headPath, `ref: ${value}\n`);
  } else {
    fs.writeFileSync(headPath, `${value}\n`);
  }
}

/**
 * Resolve a ref name to a commit hash.
 * Handles: branch names, full ref paths, HEAD, commit hashes
 */
function resolveRef(repoPath, ref) {
  if (!ref) return null;

  // If it looks like a full SHA-256 hash and exists as an object, return it
  if (/^[a-f0-9]{64}$/.test(ref) && objectExists(repoPath, ref)) {
    return ref;
  }

  // If it's HEAD, resolve the symbolic ref
  if (ref === 'HEAD') {
    const head = readHead(repoPath);
    if (head.symbolic) {
      return resolveRef(repoPath, head.ref);
    }
    return head.hash || null;
  }

  // Try as full ref path
  const fullRefPath = path.join(repoPath, ref);
  if (fs.existsSync(fullRefPath) && fs.statSync(fullRefPath).isFile()) {
    return fs.readFileSync(fullRefPath, 'utf8').trim();
  }

  // Try as branch name: refs/heads/<ref>
  const branchPath = path.join(repoPath, 'refs', 'heads', ref);
  if (fs.existsSync(branchPath)) {
    return fs.readFileSync(branchPath, 'utf8').trim();
  }

  // Try as tag: refs/tags/<ref>
  const tagPath = path.join(repoPath, 'refs', 'tags', ref);
  if (fs.existsSync(tagPath)) {
    return fs.readFileSync(tagPath, 'utf8').trim();
  }

  // Try as short hash (prefix match)
  if (/^[a-f0-9]{8,63}$/.test(ref)) {
    const dir = path.join(repoPath, 'objects', ref.slice(0, 2));
    if (fs.existsSync(dir)) {
      const rest = ref.slice(2);
      const matches = fs.readdirSync(dir).filter(f => f.startsWith(rest));
      if (matches.length === 1) {
        return ref.slice(0, 2) + matches[0];
      }
    }
  }

  return null;
}

/**
 * Update a ref to point to a new hash
 */
function updateRef(repoPath, refName, hash) {
  // Ensure refName is a full path like refs/heads/main
  const refPath = path.join(repoPath, refName);
  const dir = path.dirname(refPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(refPath, hash + '\n');
}

/**
 * Delete a ref
 */
function deleteRef(repoPath, refName) {
  const refPath = path.join(repoPath, refName);
  if (fs.existsSync(refPath)) {
    fs.unlinkSync(refPath);
  }
}

/**
 * List all refs under a prefix (e.g., 'refs/heads/')
 * @returns {Array<{name: string, hash: string}>}
 */
function listRefs(repoPath, prefix = 'refs/') {
  const refs = [];
  const baseDir = path.join(repoPath, prefix);

  if (!fs.existsSync(baseDir)) return refs;

  function walk(dir, currentPrefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const refName = currentPrefix + entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, refName + '/');
      } else {
        const hash = fs.readFileSync(fullPath, 'utf8').trim();
        refs.push({ name: prefix + refName, hash });
      }
    }
  }

  walk(baseDir, '');
  return refs;
}

// ─── Tree Walking ────────────────────────────────────────────

/**
 * Recursively walk a tree and return a flat file manifest
 * @returns {Array<{path: string, hash: string, mode: string, size: number}>}
 */
function walkTree(repoPath, treeHash, basePath = '') {
  const entries = readTree(repoPath, treeHash);
  let result = [];

  for (const entry of entries) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;

    if (entry.type === 'tree') {
      result = result.concat(walkTree(repoPath, entry.hash, entryPath));
    } else {
      // Get blob size
      let size = 0;
      try {
        const blob = readBlob(repoPath, entry.hash);
        size = blob.length;
      } catch { /* ignore */ }

      result.push({
        path: entryPath,
        hash: entry.hash,
        mode: entry.mode,
        size,
      });
    }
  }

  return result;
}

/**
 * Resolve a path within a tree to get the blob/tree hash
 * e.g., resolveTreePath(repoPath, treeHash, 'src/app.js') → blob hash
 */
function resolveTreePath(repoPath, treeHash, filePath) {
  if (!filePath || filePath === '' || filePath === '.') {
    return { type: 'tree', hash: treeHash };
  }

  const parts = filePath.split('/').filter(Boolean);
  let currentHash = treeHash;

  for (let i = 0; i < parts.length; i++) {
    const entries = readTree(repoPath, currentHash);
    const entry = entries.find(e => e.name === parts[i]);
    if (!entry) return null;

    if (i === parts.length - 1) {
      return { type: entry.type, hash: entry.hash };
    }

    if (entry.type !== 'tree') return null;
    currentHash = entry.hash;
  }

  return null;
}

// ─── Repository Init ─────────────────────────────────────────

/**
 * Initialize a bare repository with VPC VCS structure
 */
function initBareRepo(repoPath) {
  fs.mkdirSync(path.join(repoPath, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, 'refs', 'tags'), { recursive: true });
  writeHead(repoPath, 'refs/heads/main');
}

/**
 * Create an initial commit with a README
 */
function initRepoWithReadme(repoPath, repoName, description, authorName) {
  const readmeContent = `# ${repoName}\n\n${description || ''}\n`;

  // Create blob
  const blobHash = createBlob(repoPath, readmeContent);

  // Create tree with single entry
  const treeHash = createTree(repoPath, [
    { mode: '100644', name: 'README.md', hash: blobHash },
  ]);

  // Create commit
  const commitHash = createCommit(repoPath, {
    tree: treeHash,
    parents: [],
    authorName,
    authorEmail: `${authorName}@vpshub`,
    message: 'Initial commit',
  });

  // Update main branch ref
  updateRef(repoPath, 'refs/heads/main', commitHash);

  return commitHash;
}

// ─── Build Tree from Flat Manifest ───────────────────────────

/**
 * Build a tree hierarchy from a flat list of file entries.
 * Used when creating commits from a set of files.
 *
 * @param {Array<{path: string, hash: string, mode: string}>} files - flat file list
 * @returns {string} root tree hash
 */
function buildTreeFromFiles(repoPath, files) {
  // Group files by top-level directory
  const topLevel = new Map(); // name → { files: [], dirs: Map }

  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) {
      // File at root level
      if (!topLevel.has(null)) topLevel.set(null, []);
      topLevel.get(null).push({ name: parts[0], hash: file.hash, mode: file.mode || '100644' });
    } else {
      // File in a subdirectory
      const dirName = parts[0];
      if (!topLevel.has(dirName)) topLevel.set(dirName, []);
      topLevel.get(dirName).push({
        ...file,
        path: parts.slice(1).join('/'),
      });
    }
  }

  const entries = [];

  // Process root-level files
  const rootFiles = topLevel.get(null) || [];
  for (const f of rootFiles) {
    entries.push({ mode: f.mode, name: f.name, hash: f.hash });
  }

  // Recursively build subtrees
  for (const [dirName, subFiles] of topLevel) {
    if (dirName === null) continue;
    const subTreeHash = buildTreeFromFiles(repoPath, subFiles);
    entries.push({ mode: '040000', name: dirName, hash: subTreeHash });
  }

  return createTree(repoPath, entries);
}

// ─── Commit Walking ──────────────────────────────────────────

/**
 * Walk commit history from a starting commit
 * @param {string} startHash - starting commit hash
 * @param {number} limit - max commits to return
 * @param {number} offset - commits to skip
 * @returns {Array} commit objects
 */
function walkCommits(repoPath, startHash, { limit = 30, offset = 0 } = {}) {
  const commits = [];
  const visited = new Set();
  const queue = [startHash];
  let skipped = 0;

  while (queue.length > 0 && commits.length < limit) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = readCommit(repoPath, hash);

      if (skipped < offset) {
        skipped++;
      } else {
        commits.push(commit);
      }

      // Add parents to queue (first parent first for linear history)
      for (const parent of commit.parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    } catch {
      break;
    }
  }

  // Sort by date descending
  commits.sort((a, b) => (b.authorDate || 0) - (a.authorDate || 0));

  return commits;
}

/**
 * Count total commits reachable from a ref
 */
function countCommits(repoPath, startHash) {
  const visited = new Set();
  const queue = [startHash];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = readCommit(repoPath, hash);
      for (const parent of commit.parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    } catch {
      break;
    }
  }

  return visited.size;
}

// ─── DB Sync (keep PostgreSQL in sync with filesystem) ───────

/**
 * Sync all refs from filesystem to database
 */
async function syncRefsToDb(pool, repoId, repoPath) {
  const refs = listRefs(repoPath, 'refs/');

  // Also include HEAD
  const head = readHead(repoPath);
  if (!head.symbolic && head.hash) {
    refs.push({ name: 'HEAD', hash: head.hash });
  }

  for (const ref of refs) {
    await pool.query(
      `INSERT INTO vpshub_refs (repo_id, name, target_hash, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (repo_id, name) DO UPDATE SET target_hash = $3, updated_at = NOW()`,
      [repoId, ref.name, ref.hash]
    );
  }

  // Remove stale refs
  const refNames = refs.map(r => r.name);
  if (refNames.length > 0) {
    await pool.query(
      `DELETE FROM vpshub_refs WHERE repo_id = $1 AND name != ALL($2::varchar[])`,
      [repoId, refNames]
    );
  }
}

/**
 * Index a commit and its ancestors into the database
 * Only indexes commits not already in the DB
 */
async function syncCommitsToDb(pool, repoId, repoPath, startHash) {
  const queue = [startHash];
  const visited = new Set();

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);

    // Check if already in DB
    const { rows } = await pool.query(
      'SELECT 1 FROM vpshub_commits WHERE repo_id = $1 AND hash = $2',
      [repoId, hash]
    );
    if (rows.length > 0) continue; // Already indexed, ancestors likely indexed too

    try {
      const commit = readCommit(repoPath, hash);

      const authorDateTs = commit.authorDate
        ? new Date(commit.authorDate * 1000).toISOString()
        : null;
      const committerDateTs = commit.committerDate
        ? new Date(commit.committerDate * 1000).toISOString()
        : null;

      await pool.query(
        `INSERT INTO vpshub_commits
         (repo_id, hash, tree_hash, author_name, author_email, author_date,
          committer_name, committer_email, committer_date, message, body, parent_hashes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (repo_id, hash) DO NOTHING`,
        [
          repoId, hash, commit.tree,
          commit.authorName, commit.authorEmail, authorDateTs,
          commit.committerName, commit.committerEmail, committerDateTs,
          commit.message, commit.body || '', commit.parents,
        ]
      );

      for (const parent of commit.parents) {
        if (!visited.has(parent)) {
          queue.push(parent);
        }
      }
    } catch {
      break;
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────

/**
 * Get the total size of all objects in a repo (in bytes)
 */
function getRepoObjectsSize(repoPath) {
  const objectsDir = path.join(repoPath, 'objects');
  if (!fs.existsSync(objectsDir)) return 0;

  let totalSize = 0;
  const prefixes = fs.readdirSync(objectsDir);
  for (const prefix of prefixes) {
    const prefixDir = path.join(objectsDir, prefix);
    if (!fs.statSync(prefixDir).isDirectory()) continue;
    const files = fs.readdirSync(prefixDir);
    for (const file of files) {
      const stat = fs.statSync(path.join(prefixDir, file));
      totalSize += stat.size;
    }
  }
  return totalSize;
}

/**
 * List all object hashes in a repo
 * @returns {string[]}
 */
function listAllObjects(repoPath) {
  const objectsDir = path.join(repoPath, 'objects');
  if (!fs.existsSync(objectsDir)) return [];

  const hashes = [];
  const prefixes = fs.readdirSync(objectsDir);
  for (const prefix of prefixes) {
    const prefixDir = path.join(objectsDir, prefix);
    if (!fs.statSync(prefixDir).isDirectory()) continue;
    const files = fs.readdirSync(prefixDir);
    for (const file of files) {
      hashes.push(prefix + file);
    }
  }
  return hashes;
}

/**
 * Collect all objects reachable from a commit (for transfer)
 * @returns {Set<string>}
 */
function collectReachableObjects(repoPath, commitHash, excludeSet = new Set()) {
  const objects = new Set();
  const commitQueue = [commitHash];
  const visitedCommits = new Set();

  while (commitQueue.length > 0) {
    const hash = commitQueue.shift();
    if (!hash || visitedCommits.has(hash) || excludeSet.has(hash)) continue;
    visitedCommits.add(hash);
    objects.add(hash);

    try {
      const commit = readCommit(repoPath, hash);

      // Add tree and all descendant objects
      collectTreeObjects(repoPath, commit.tree, objects, excludeSet);

      // Add parent commits to queue
      for (const parent of commit.parents) {
        if (!visitedCommits.has(parent) && !excludeSet.has(parent)) {
          commitQueue.push(parent);
        }
      }
    } catch {
      break;
    }
  }

  return objects;
}

/**
 * Collect all objects in a tree recursively
 */
function collectTreeObjects(repoPath, treeHash, objects = new Set(), excludeSet = new Set()) {
  if (objects.has(treeHash) || excludeSet.has(treeHash)) return;
  objects.add(treeHash);

  try {
    const entries = readTree(repoPath, treeHash);
    for (const entry of entries) {
      if (excludeSet.has(entry.hash)) continue;
      if (entry.type === 'tree') {
        collectTreeObjects(repoPath, entry.hash, objects, excludeSet);
      } else {
        objects.add(entry.hash);
      }
    }
  } catch { /* ignore */ }
}

module.exports = {
  REPOS_DIR,
  // Hashing
  hashObject,
  serializeObject,
  // Object store
  objectPath,
  objectExists,
  writeObject,
  readObject,
  readObjectRaw,
  // Blobs
  createBlob,
  readBlob,
  // Trees
  serializeTreeEntries,
  parseTree,
  createTree,
  readTree,
  walkTree,
  resolveTreePath,
  buildTreeFromFiles,
  // Commits
  serializeCommitContent,
  parseCommit,
  createCommit,
  readCommit,
  walkCommits,
  countCommits,
  // Refs
  readHead,
  writeHead,
  resolveRef,
  updateRef,
  deleteRef,
  listRefs,
  // Repo init
  initBareRepo,
  initRepoWithReadme,
  // DB sync
  syncRefsToDb,
  syncCommitsToDb,
  // Utility
  getRepoObjectsSize,
  listAllObjects,
  collectReachableObjects,
  collectTreeObjects,
};
