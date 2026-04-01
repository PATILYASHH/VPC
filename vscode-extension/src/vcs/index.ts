/**
 * VPC VCS Staging Area (Index)
 */

import * as fs from 'fs';
import * as path from 'path';
import { vpcDir, hashObject, createBlob, walkTree, FileManifestEntry } from './objects';

export interface IndexEntry {
  path: string;
  hash: string;
  mode: string;
  size: number;
  mtime: number;
}

export interface VpcIndex {
  entries: IndexEntry[];
}

function indexPath(root: string): string {
  return path.join(vpcDir(root), 'index');
}

export function readIndex(root: string): VpcIndex {
  const idxPath = indexPath(root);
  if (!fs.existsSync(idxPath)) { return { entries: [] }; }
  try { return JSON.parse(fs.readFileSync(idxPath, 'utf8')); }
  catch { return { entries: [] }; }
}

export function writeIndex(root: string, index: VpcIndex): void {
  fs.writeFileSync(indexPath(root), JSON.stringify(index, null, 2));
}

export function stageFile(root: string, filePath: string): string | null {
  const absPath = path.resolve(root, filePath);
  const index = readIndex(root);

  if (!fs.existsSync(absPath)) {
    // File deleted — remove from index
    index.entries = index.entries.filter(e => e.path !== filePath);
    writeIndex(root, index);
    return null;
  }

  const content = fs.readFileSync(absPath);
  const hash = createBlob(root, content);
  const stat = fs.statSync(absPath);
  const mode = stat.mode & 0o111 ? '100755' : '100644';

  const entry: IndexEntry = { path: filePath, hash, mode, size: stat.size, mtime: stat.mtimeMs };
  const existing = index.entries.findIndex(e => e.path === filePath);
  if (existing >= 0) { index.entries[existing] = entry; }
  else { index.entries.push(entry); }

  index.entries.sort((a, b) => a.path.localeCompare(b.path));
  writeIndex(root, index);
  return hash;
}

export function unstageFile(root: string, filePath: string): void {
  const index = readIndex(root);
  index.entries = index.entries.filter(e => e.path !== filePath);
  writeIndex(root, index);
}

export function stageAllFiles(root: string): number {
  const allFiles = getAllWorkspaceFiles(root);
  const index = readIndex(root);
  const indexMap = new Map(index.entries.map(e => [e.path, e.hash]));

  let staged = 0;
  for (const filePath of allFiles) {
    const absPath = path.resolve(root, filePath);
    const content = fs.readFileSync(absPath);
    const hash = hashObject('blob', content);
    // Only stage if changed from index
    if (indexMap.get(filePath) !== hash) {
      stageFile(root, filePath);
      staged++;
    }
  }

  // Handle deleted files (in index but not on disk)
  for (const entry of index.entries) {
    if (!fs.existsSync(path.resolve(root, entry.path))) {
      stageFile(root, entry.path); // removes from index
      staged++;
    }
  }

  return staged;
}

export function buildIndexFromTree(root: string, treeHash: string): void {
  const manifest = walkTree(root, treeHash);
  const index: VpcIndex = {
    entries: manifest.map(f => ({
      path: f.path, hash: f.hash, mode: f.mode || '100644', size: 0, mtime: Date.now(),
    })),
  };
  writeIndex(root, index);
}

export function isFileModified(root: string, filePath: string): boolean {
  const absPath = path.resolve(root, filePath);
  if (!fs.existsSync(absPath)) { return true; }
  const content = fs.readFileSync(absPath);
  const currentHash = hashObject('blob', content);
  const index = readIndex(root);
  const entry = index.entries.find(e => e.path === filePath);
  if (!entry) { return true; }
  return entry.hash !== currentHash;
}

const IGNORE_PATTERNS = ['.vpc', 'node_modules', '.git', '.DS_Store', '.env', 'dist', 'out', '.vscode', '__pycache__', '.next'];

export function getAllWorkspaceFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE_PATTERNS.includes(entry.name)) { continue; }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fullPath); }
        else if (entry.isFile()) { results.push(path.relative(root, fullPath)); }
      }
    } catch { /* skip unreadable */ }
  }
  walk(root);
  return results;
}
