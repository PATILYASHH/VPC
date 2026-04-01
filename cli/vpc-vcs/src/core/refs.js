/**
 * VPC VCS Client-Side Ref Management
 */

const fs = require('fs');
const path = require('path');
const { vpcDir } = require('./objects');

function readHead(root) {
  const headPath = path.join(vpcDir(root), 'HEAD');
  if (!fs.existsSync(headPath)) return { symbolic: true, ref: 'refs/heads/main' };
  const content = fs.readFileSync(headPath, 'utf8').trim();
  if (content.startsWith('ref: ')) return { symbolic: true, ref: content.slice(5) };
  return { symbolic: false, hash: content };
}

function writeHead(root, value) {
  const headPath = path.join(vpcDir(root), 'HEAD');
  if (value.startsWith('refs/')) {
    fs.writeFileSync(headPath, `ref: ${value}\n`);
  } else {
    fs.writeFileSync(headPath, `${value}\n`);
  }
}

function getCurrentBranch(root) {
  const head = readHead(root);
  if (head.symbolic) return head.ref.replace('refs/heads/', '');
  return null; // detached HEAD
}

function resolveRef(root, ref) {
  const vpcBase = vpcDir(root);

  if (/^[a-f0-9]{64}$/.test(ref)) return ref;

  if (ref === 'HEAD') {
    const head = readHead(root);
    if (head.symbolic) return resolveRef(root, head.ref);
    return head.hash || null;
  }

  // Full ref path
  const fullPath = path.join(vpcBase, ref);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fs.readFileSync(fullPath, 'utf8').trim();
  }

  // Branch name
  const branchPath = path.join(vpcBase, 'refs', 'heads', ref);
  if (fs.existsSync(branchPath)) return fs.readFileSync(branchPath, 'utf8').trim();

  // Remote tracking
  const remotePath = path.join(vpcBase, 'refs', 'remotes', 'origin', ref);
  if (fs.existsSync(remotePath)) return fs.readFileSync(remotePath, 'utf8').trim();

  // Tag
  const tagPath = path.join(vpcBase, 'refs', 'tags', ref);
  if (fs.existsSync(tagPath)) return fs.readFileSync(tagPath, 'utf8').trim();

  return null;
}

function updateRef(root, refName, hash) {
  const refPath = path.join(vpcDir(root), refName);
  const dir = path.dirname(refPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(refPath, hash + '\n');
}

function deleteRef(root, refName) {
  const refPath = path.join(vpcDir(root), refName);
  if (fs.existsSync(refPath)) fs.unlinkSync(refPath);
}

function listRefs(root, prefix = 'refs/') {
  const refs = [];
  const baseDir = path.join(vpcDir(root), prefix);
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

function listBranches(root) {
  return listRefs(root, 'refs/heads/').map(r => ({
    name: r.name.replace('refs/heads/', ''),
    hash: r.hash,
  }));
}

module.exports = {
  readHead, writeHead, getCurrentBranch,
  resolveRef, updateRef, deleteRef,
  listRefs, listBranches,
};
