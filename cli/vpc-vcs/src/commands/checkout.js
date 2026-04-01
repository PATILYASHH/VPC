const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const objects = require('../core/objects');
const refs = require('../core/refs');
const { buildIndexFromTree } = require('../core/index');

async function checkout(ref, opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  // Create and switch to new branch
  if (opts.b || opts.B) {
    const headHash = refs.resolveRef(root, 'HEAD');
    if (!headHash) {
      console.log(chalk.red('Cannot create branch: no commits yet.'));
      process.exit(1);
    }
    refs.updateRef(root, `refs/heads/${ref}`, headHash);
    refs.writeHead(root, `refs/heads/${ref}`);
    console.log(chalk.green(`Switched to new branch '${ref}'`));
    return;
  }

  // Try as branch name first
  let targetHash = refs.resolveRef(root, `refs/heads/${ref}`);
  let isBranch = !!targetHash;

  // Try as any ref
  if (!targetHash) {
    targetHash = refs.resolveRef(root, ref);
  }

  if (!targetHash) {
    console.log(chalk.red(`Branch or ref '${ref}' not found.`));
    process.exit(1);
  }

  // Read the commit and update working tree
  const commit = objects.readCommit(root, targetHash);
  const manifest = objects.walkTree(root, commit.tree);

  // Clean working tree (remove tracked files)
  const currentHead = refs.resolveRef(root, 'HEAD');
  if (currentHead) {
    try {
      const currentCommit = objects.readCommit(root, currentHead);
      const currentManifest = objects.walkTree(root, currentCommit.tree);
      for (const file of currentManifest) {
        const absPath = path.resolve(root, file.path);
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
      }
      // Clean up empty directories
      cleanEmptyDirs(root);
    } catch { /* ignore */ }
  }

  // Write new files
  for (const file of manifest) {
    const absPath = path.resolve(root, file.path);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const content = objects.readBlob(root, file.hash);
    fs.writeFileSync(absPath, content);

    if (file.mode === '100755') {
      fs.chmodSync(absPath, 0o755);
    }
  }

  // Update index
  buildIndexFromTree(root, objects, commit.tree);

  // Update HEAD
  if (isBranch) {
    refs.writeHead(root, `refs/heads/${ref}`);
    console.log(chalk.green(`Switched to branch '${ref}'`));
  } else {
    refs.writeHead(root, targetHash);
    console.log(chalk.yellow(`HEAD is now at ${targetHash.slice(0, 12)} (detached)`));
  }
}

function cleanEmptyDirs(root) {
  const ignorePatterns = ['.vpc', 'node_modules', '.git'];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      }
    }
    // Remove if empty (excluding root)
    if (dir !== root) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
      }
    }
  }
  walk(root);
}

module.exports = { checkout };
