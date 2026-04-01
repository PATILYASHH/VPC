/**
 * VPC VCS Client-Side Object Store
 * Same format as server — content-addressable with SHA-256
 */

const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function findRepoRoot(startDir) {
  let dir = startDir || process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.vpc'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

function vpcDir(repoRoot) {
  return path.join(repoRoot || findRepoRoot(), '.vpc');
}

function hashObject(type, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`${type} ${buf.length}\0`);
  const full = Buffer.concat([header, buf]);
  return crypto.createHash('sha256').update(full).digest('hex');
}

function serializeObject(type, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`${type} ${buf.length}\0`);
  return Buffer.concat([header, buf]);
}

function objectPath(root, hash) {
  return path.join(vpcDir(root), 'objects', hash.slice(0, 2), hash.slice(2));
}

function objectExists(root, hash) {
  return fs.existsSync(objectPath(root, hash));
}

function writeObject(root, hash, data) {
  const objPath = objectPath(root, hash);
  const dir = path.dirname(objPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(objPath)) {
    const compressed = zlib.deflateSync(data);
    fs.writeFileSync(objPath, compressed);
  }
  return hash;
}

function readObject(root, hash) {
  const objPath = objectPath(root, hash);
  if (!fs.existsSync(objPath)) throw new Error(`Object not found: ${hash}`);
  const compressed = fs.readFileSync(objPath);
  const data = zlib.inflateSync(compressed);
  const nullIdx = data.indexOf(0);
  const header = data.slice(0, nullIdx).toString();
  const [type] = header.split(' ');
  const content = data.slice(nullIdx + 1);
  return { type, content };
}

function readObjectRaw(root, hash) {
  const objPath = objectPath(root, hash);
  if (!fs.existsSync(objPath)) throw new Error(`Object not found: ${hash}`);
  return fs.readFileSync(objPath);
}

function createBlob(root, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = hashObject('blob', buf);
  const serialized = serializeObject('blob', buf);
  writeObject(root, hash, serialized);
  return hash;
}

function readBlob(root, hash) {
  const obj = readObject(root, hash);
  if (obj.type !== 'blob') throw new Error(`Expected blob, got ${obj.type}`);
  return obj.content;
}

function serializeTreeEntries(entries) {
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === '040000' ? a.name + '/' : a.name;
    const bName = b.mode === '040000' ? b.name + '/' : b.name;
    return aName.localeCompare(bName);
  });
  const parts = [];
  for (const entry of sorted) {
    parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`));
    parts.push(Buffer.from(entry.hash, 'hex'));
  }
  return Buffer.concat(parts);
}

function parseTree(data) {
  const entries = [];
  let offset = 0;
  while (offset < data.length) {
    const nullIdx = data.indexOf(0, offset);
    if (nullIdx === -1) break;
    const modeNameStr = data.slice(offset, nullIdx).toString();
    const spaceIdx = modeNameStr.indexOf(' ');
    const mode = modeNameStr.slice(0, spaceIdx);
    const name = modeNameStr.slice(spaceIdx + 1);
    const hashBin = data.slice(nullIdx + 1, nullIdx + 1 + 32);
    const hash = hashBin.toString('hex');
    entries.push({ mode, name, hash, type: mode === '040000' ? 'tree' : 'blob' });
    offset = nullIdx + 1 + 32;
  }
  return entries;
}

function createTree(root, entries) {
  const content = serializeTreeEntries(entries);
  const hash = hashObject('tree', content);
  const serialized = serializeObject('tree', content);
  writeObject(root, hash, serialized);
  return hash;
}

function readTree(root, hash) {
  const obj = readObject(root, hash);
  if (obj.type !== 'tree') throw new Error(`Expected tree, got ${obj.type}`);
  return parseTree(obj.content);
}

function serializeCommitContent({ tree, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message }) {
  const lines = [];
  lines.push(`tree ${tree}`);
  for (const parent of (parents || [])) lines.push(`parent ${parent}`);
  const aDate = authorDate || Math.floor(Date.now() / 1000);
  const cDate = committerDate || aDate;
  lines.push(`author ${authorName} <${authorEmail}> ${aDate} +0000`);
  lines.push(`committer ${committerName || authorName} <${committerEmail || authorEmail}> ${cDate} +0000`);
  lines.push('');
  lines.push(message);
  return Buffer.from(lines.join('\n'));
}

function parseCommit(data) {
  const text = data.toString();
  const blankIdx = text.indexOf('\n\n');
  const headerSection = text.slice(0, blankIdx);
  const messageSection = text.slice(blankIdx + 2);

  const headers = headerSection.split('\n');
  let tree = '';
  const parents = [];
  let authorName = '', authorEmail = '', authorDate = 0;
  let committerName = '', committerEmail = '', committerDate = 0;

  for (const line of headers) {
    if (line.startsWith('tree ')) tree = line.slice(5);
    else if (line.startsWith('parent ')) parents.push(line.slice(7));
    else if (line.startsWith('author ')) {
      const match = line.match(/^author (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (match) { authorName = match[1]; authorEmail = match[2]; authorDate = parseInt(match[3]); }
    } else if (line.startsWith('committer ')) {
      const match = line.match(/^committer (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (match) { committerName = match[1]; committerEmail = match[2]; committerDate = parseInt(match[3]); }
    }
  }

  const msgLines = messageSection.split('\n');
  return { tree, parents, authorName, authorEmail, authorDate, committerName, committerEmail, committerDate, message: msgLines[0] || '', body: msgLines.slice(1).join('\n').trim() };
}

function createCommit(root, opts) {
  const content = serializeCommitContent(opts);
  const hash = hashObject('commit', content);
  const serialized = serializeObject('commit', content);
  writeObject(root, hash, serialized);
  return hash;
}

function readCommit(root, hash) {
  const obj = readObject(root, hash);
  if (obj.type !== 'commit') throw new Error(`Expected commit, got ${obj.type}`);
  return { hash, ...parseCommit(obj.content) };
}

function walkTree(root, treeHash, basePath = '') {
  const entries = readTree(root, treeHash);
  let result = [];
  for (const entry of entries) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.type === 'tree') {
      result = result.concat(walkTree(root, entry.hash, entryPath));
    } else {
      result.push({ path: entryPath, hash: entry.hash, mode: entry.mode });
    }
  }
  return result;
}

function buildTreeFromFiles(root, files) {
  const topLevel = new Map();
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) {
      if (!topLevel.has(null)) topLevel.set(null, []);
      topLevel.get(null).push({ name: parts[0], hash: file.hash, mode: file.mode || '100644' });
    } else {
      const dirName = parts[0];
      if (!topLevel.has(dirName)) topLevel.set(dirName, []);
      topLevel.get(dirName).push({ ...file, path: parts.slice(1).join('/') });
    }
  }

  const entries = [];
  const rootFiles = topLevel.get(null) || [];
  for (const f of rootFiles) entries.push({ mode: f.mode, name: f.name, hash: f.hash });

  for (const [dirName, subFiles] of topLevel) {
    if (dirName === null) continue;
    const subTreeHash = buildTreeFromFiles(root, subFiles);
    entries.push({ mode: '040000', name: dirName, hash: subTreeHash });
  }

  return createTree(root, entries);
}

function listAllObjects(root) {
  const objectsDir = path.join(vpcDir(root), 'objects');
  if (!fs.existsSync(objectsDir)) return [];
  const hashes = [];
  for (const prefix of fs.readdirSync(objectsDir)) {
    const prefixDir = path.join(objectsDir, prefix);
    if (!fs.statSync(prefixDir).isDirectory()) continue;
    for (const file of fs.readdirSync(prefixDir)) {
      hashes.push(prefix + file);
    }
  }
  return hashes;
}

module.exports = {
  findRepoRoot, vpcDir, hashObject, serializeObject,
  objectPath, objectExists, writeObject, readObject, readObjectRaw,
  createBlob, readBlob,
  serializeTreeEntries, parseTree, createTree, readTree, walkTree,
  buildTreeFromFiles, serializeCommitContent, parseCommit, createCommit, readCommit,
  listAllObjects,
};
