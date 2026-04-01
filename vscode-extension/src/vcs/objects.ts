/**
 * VPC VCS Object Store — TypeScript port
 * Content-addressable storage with SHA-256 hashing
 */

import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';

export interface TreeEntry {
  mode: string;
  name: string;
  hash: string;
  type: 'blob' | 'tree';
}

export interface CommitData {
  hash: string;
  tree: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: number;
  committerName: string;
  committerEmail: string;
  committerDate: number;
  message: string;
  body: string;
}

export interface FileManifestEntry {
  path: string;
  hash: string;
  mode: string;
}

export function vpcDir(root: string): string {
  return path.join(root, '.vpc');
}

export function hasVpcRepo(root: string): boolean {
  return fs.existsSync(vpcDir(root));
}

// ─── Hashing ─────────────────────────────────────────────────

export function hashObject(type: string, content: Buffer): string {
  const header = Buffer.from(`${type} ${content.length}\0`);
  const full = Buffer.concat([header, content]);
  return crypto.createHash('sha256').update(full).digest('hex');
}

function serializeObject(type: string, content: Buffer): Buffer {
  const header = Buffer.from(`${type} ${content.length}\0`);
  return Buffer.concat([header, content]);
}

// ─── Object Storage ──────────────────────────────────────────

export function objectPath(root: string, hash: string): string {
  return path.join(vpcDir(root), 'objects', hash.slice(0, 2), hash.slice(2));
}

export function objectExists(root: string, hash: string): boolean {
  return fs.existsSync(objectPath(root, hash));
}

export function writeObject(root: string, hash: string, data: Buffer): string {
  const objPath = objectPath(root, hash);
  const dir = path.dirname(objPath);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  if (!fs.existsSync(objPath)) {
    const compressed = zlib.deflateSync(data);
    fs.writeFileSync(objPath, compressed);
  }
  return hash;
}

export function readObject(root: string, hash: string): { type: string; content: Buffer } {
  const objPath = objectPath(root, hash);
  if (!fs.existsSync(objPath)) { throw new Error(`Object not found: ${hash}`); }
  const compressed = fs.readFileSync(objPath);
  const data = zlib.inflateSync(compressed);
  const nullIdx = data.indexOf(0);
  const header = data.slice(0, nullIdx).toString();
  const [type] = header.split(' ');
  const content = data.slice(nullIdx + 1);
  return { type, content };
}

export function readObjectRaw(root: string, hash: string): Buffer {
  const objPath = objectPath(root, hash);
  if (!fs.existsSync(objPath)) { throw new Error(`Object not found: ${hash}`); }
  return fs.readFileSync(objPath);
}

// ─── Blobs ───────────────────────────────────────────────────

export function createBlob(root: string, content: Buffer | string): string {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = hashObject('blob', buf);
  writeObject(root, hash, serializeObject('blob', buf));
  return hash;
}

export function readBlob(root: string, hash: string): Buffer {
  const obj = readObject(root, hash);
  if (obj.type !== 'blob') { throw new Error(`Expected blob, got ${obj.type}`); }
  return obj.content;
}

// ─── Trees ───────────────────────────────────────────────────

export function serializeTreeEntries(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === '040000' ? a.name + '/' : a.name;
    const bName = b.mode === '040000' ? b.name + '/' : b.name;
    return aName.localeCompare(bName);
  });
  const parts: Buffer[] = [];
  for (const entry of sorted) {
    parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`));
    parts.push(Buffer.from(entry.hash, 'hex'));
  }
  return Buffer.concat(parts);
}

export function parseTree(data: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;
  while (offset < data.length) {
    const nullIdx = data.indexOf(0, offset);
    if (nullIdx === -1) { break; }
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

export function createTree(root: string, entries: TreeEntry[]): string {
  const content = serializeTreeEntries(entries);
  const hash = hashObject('tree', content);
  writeObject(root, hash, serializeObject('tree', content));
  return hash;
}

export function readTree(root: string, hash: string): TreeEntry[] {
  const obj = readObject(root, hash);
  if (obj.type !== 'tree') { throw new Error(`Expected tree, got ${obj.type}`); }
  return parseTree(obj.content);
}

// ─── Commits ─────────────────────────────────────────────────

export function createCommit(root: string, opts: {
  tree: string; parents: string[]; authorName: string; authorEmail: string;
  authorDate?: number; committerName?: string; committerEmail?: string;
  committerDate?: number; message: string;
}): string {
  const aDate = opts.authorDate || Math.floor(Date.now() / 1000);
  const cDate = opts.committerDate || aDate;
  const lines: string[] = [];
  lines.push(`tree ${opts.tree}`);
  for (const p of opts.parents) { lines.push(`parent ${p}`); }
  lines.push(`author ${opts.authorName} <${opts.authorEmail}> ${aDate} +0000`);
  lines.push(`committer ${opts.committerName || opts.authorName} <${opts.committerEmail || opts.authorEmail}> ${cDate} +0000`);
  lines.push('');
  lines.push(opts.message);
  const content = Buffer.from(lines.join('\n'));
  const hash = hashObject('commit', content);
  writeObject(root, hash, serializeObject('commit', content));
  return hash;
}

export function readCommit(root: string, hash: string): CommitData {
  const obj = readObject(root, hash);
  if (obj.type !== 'commit') { throw new Error(`Expected commit, got ${obj.type}`); }
  const text = obj.content.toString();
  const blankIdx = text.indexOf('\n\n');
  const headerSection = text.slice(0, blankIdx);
  const messageSection = text.slice(blankIdx + 2);
  const headers = headerSection.split('\n');

  let tree = '';
  const parents: string[] = [];
  let authorName = '', authorEmail = '', authorDate = 0;
  let committerName = '', committerEmail = '', committerDate = 0;

  for (const line of headers) {
    if (line.startsWith('tree ')) { tree = line.slice(5); }
    else if (line.startsWith('parent ')) { parents.push(line.slice(7)); }
    else if (line.startsWith('author ')) {
      const m = line.match(/^author (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (m) { authorName = m[1]; authorEmail = m[2]; authorDate = parseInt(m[3]); }
    } else if (line.startsWith('committer ')) {
      const m = line.match(/^committer (.+?) <(.+?)> (\d+) ([+-]\d{4})$/);
      if (m) { committerName = m[1]; committerEmail = m[2]; committerDate = parseInt(m[3]); }
    }
  }

  const msgLines = messageSection.split('\n');
  return {
    hash, tree, parents, authorName, authorEmail, authorDate,
    committerName, committerEmail, committerDate,
    message: msgLines[0] || '', body: msgLines.slice(1).join('\n').trim(),
  };
}

// ─── Tree Walking ────────────────────────────────────────────

export function walkTree(root: string, treeHash: string, basePath: string = ''): FileManifestEntry[] {
  const entries = readTree(root, treeHash);
  let result: FileManifestEntry[] = [];
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

export function buildTreeFromFiles(root: string, files: FileManifestEntry[]): string {
  const topLevel = new Map<string | null, any[]>();
  for (const file of files) {
    const parts = file.path.split('/');
    if (parts.length === 1) {
      if (!topLevel.has(null)) { topLevel.set(null, []); }
      topLevel.get(null)!.push({ name: parts[0], hash: file.hash, mode: file.mode || '100644' });
    } else {
      const dirName = parts[0];
      if (!topLevel.has(dirName)) { topLevel.set(dirName, []); }
      topLevel.get(dirName)!.push({ ...file, path: parts.slice(1).join('/') });
    }
  }
  const entries: TreeEntry[] = [];
  const rootFiles = topLevel.get(null) || [];
  for (const f of rootFiles) { entries.push({ mode: f.mode, name: f.name, hash: f.hash, type: 'blob' }); }
  for (const [dirName, subFiles] of topLevel) {
    if (dirName === null) { continue; }
    const subTreeHash = buildTreeFromFiles(root, subFiles);
    entries.push({ mode: '040000', name: dirName, hash: subTreeHash, type: 'tree' });
  }
  return createTree(root, entries);
}

// ─── Repo Init ───────────────────────────────────────────────

export function initRepo(root: string): void {
  const vpc = vpcDir(root);
  fs.mkdirSync(path.join(vpc, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(vpc, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(path.join(vpc, 'refs', 'tags'), { recursive: true });
  fs.mkdirSync(path.join(vpc, 'refs', 'remotes', 'origin'), { recursive: true });
  fs.writeFileSync(path.join(vpc, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(vpc, 'config'), JSON.stringify({ remotes: {} }, null, 2));
  fs.writeFileSync(path.join(vpc, 'index'), JSON.stringify({ entries: [] }, null, 2));
}

// ─── Object Collection (for transfer) ────────────────────────

export function collectReachableObjects(root: string, commitHash: string, excludeSet: Set<string> = new Set()): Set<string> {
  const objects = new Set<string>();
  const queue = [commitHash];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (!hash || visited.has(hash) || excludeSet.has(hash)) { continue; }
    visited.add(hash);
    objects.add(hash);
    try {
      const commit = readCommit(root, hash);
      collectTreeObjects(root, commit.tree, objects, excludeSet);
      for (const parent of commit.parents) {
        if (!visited.has(parent) && !excludeSet.has(parent)) { queue.push(parent); }
      }
    } catch { break; }
  }
  return objects;
}

function collectTreeObjects(root: string, treeHash: string, objects: Set<string>, excludeSet: Set<string>): void {
  if (objects.has(treeHash) || excludeSet.has(treeHash)) { return; }
  objects.add(treeHash);
  try {
    const entries = readTree(root, treeHash);
    for (const entry of entries) {
      if (excludeSet.has(entry.hash)) { continue; }
      if (entry.type === 'tree') { collectTreeObjects(root, entry.hash, objects, excludeSet); }
      else { objects.add(entry.hash); }
    }
  } catch { /* ignore */ }
}
