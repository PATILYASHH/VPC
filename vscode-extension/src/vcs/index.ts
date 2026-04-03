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

const DEFAULT_IGNORE = ['.vpc', 'node_modules', '.git', '.DS_Store', '.env', '.env.local',
  'dist', 'out', 'build', '.vscode', '__pycache__', '.next', '.nuxt', '.cache',
  '.idea', '.gradle', 'vendor', '.dart_tool', '.pub-cache', 'target', 'obj', '.angular',
  'Thumbs.db', '*.pyc', '.sass-cache', 'coverage'];

function loadIgnorePatterns(root: string): Set<string> {
  const patterns = new Set(DEFAULT_IGNORE);
  // Load .vpcignore if it exists
  const ignorePath = path.join(root, '.vpcignore');
  if (fs.existsSync(ignorePath)) {
    try {
      const lines = fs.readFileSync(ignorePath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          patterns.add(trimmed);
        }
      }
    } catch { /* ignore read errors */ }
  }
  return patterns;
}

function shouldIgnore(name: string, ignorePatterns: Set<string>): boolean {
  if (ignorePatterns.has(name)) { return true; }
  // Check wildcard patterns like *.pyc
  for (const pattern of ignorePatterns) {
    if (pattern.startsWith('*.') && name.endsWith(pattern.slice(1))) { return true; }
  }
  return false;
}

export function getAllWorkspaceFiles(root: string): string[] {
  const ignorePatterns = loadIgnorePatterns(root);
  const results: string[] = [];
  function walk(dir: string): void {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (shouldIgnore(entry.name, ignorePatterns)) { continue; }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(fullPath); }
        else if (entry.isFile()) {
          const rel = path.relative(root, fullPath).replace(/\\/g, '/');
          results.push(rel);
        }
      }
    } catch { /* skip unreadable */ }
  }
  walk(root);
  return results;
}
