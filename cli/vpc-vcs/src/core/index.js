/**
 * VPC VCS Staging Area (Index)
 *
 * Tracks staged files as JSON in .vpc/index
 * Format: { entries: [{ path, hash, mode, size, mtime }] }
 */

const fs = require('fs');
const path = require('path');
const { vpcDir, createBlob, hashObject } = require('./objects');

function indexPath(root) {
  return path.join(vpcDir(root), 'index');
}

function readIndex(root) {
  const idxPath = indexPath(root);
  if (!fs.existsSync(idxPath)) return { entries: [] };
  try {
    return JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function writeIndex(root, index) {
  fs.writeFileSync(indexPath(root), JSON.stringify(index, null, 2));
}

/**
 * Stage a file: hash its content, add to index
 */
function stageFile(root, filePath) {
  const absPath = path.resolve(root, filePath);
  if (!fs.existsSync(absPath)) {
    // File deleted — mark as deleted in index
    const index = readIndex(root);
    index.entries = index.entries.filter(e => e.path !== filePath);
    writeIndex(root, index);
    return null;
  }

  const content = fs.readFileSync(absPath);
  const hash = createBlob(root, content);
  const stat = fs.statSync(absPath);
  const mode = stat.mode & 0o111 ? '100755' : '100644';

  const index = readIndex(root);
  const existing = index.entries.findIndex(e => e.path === filePath);

  const entry = {
    path: filePath,
    hash,
    mode,
    size: stat.size,
    mtime: stat.mtimeMs,
  };

  if (existing >= 0) {
    index.entries[existing] = entry;
  } else {
    index.entries.push(entry);
  }

  // Sort entries
  index.entries.sort((a, b) => a.path.localeCompare(b.path));
  writeIndex(root, index);

  return hash;
}

/**
 * Remove a file from the index (unstage)
 */
function unstageFile(root, filePath) {
  const index = readIndex(root);
  index.entries = index.entries.filter(e => e.path !== filePath);
  writeIndex(root, index);
}

/**
 * Check if working tree file differs from index
 */
function isFileModified(root, filePath) {
  const absPath = path.resolve(root, filePath);
  if (!fs.existsSync(absPath)) return true; // deleted

  const content = fs.readFileSync(absPath);
  const currentHash = hashObject('blob', content);

  const index = readIndex(root);
  const entry = index.entries.find(e => e.path === filePath);
  if (!entry) return true; // not in index

  return entry.hash !== currentHash;
}

/**
 * Build the index from HEAD commit's tree (used after clone/checkout)
 */
function buildIndexFromTree(root, objects, treeHash) {
  const manifest = objects.walkTree(root, treeHash);
  const index = {
    entries: manifest.map(f => ({
      path: f.path,
      hash: f.hash,
      mode: f.mode || '100644',
      size: 0,
      mtime: Date.now(),
    })),
  };
  writeIndex(root, index);
}

module.exports = {
  readIndex, writeIndex,
  stageFile, unstageFile,
  isFileModified, buildIndexFromTree,
};
