const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const os = require('os');
const objects = require('../core/objects');
const refs = require('../core/refs');
const { findMergeBase, threeWayMerge } = require('../core/merge');
const { buildIndexFromTree } = require('../core/index');

async function merge(branchName, opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  const currentBranch = refs.getCurrentBranch(root);
  const oursHash = refs.resolveRef(root, 'HEAD');
  const theirsHash = refs.resolveRef(root, `refs/heads/${branchName}`);

  if (!oursHash) {
    console.log(chalk.red('No commits on current branch.'));
    process.exit(1);
  }
  if (!theirsHash) {
    console.log(chalk.red(`Branch '${branchName}' not found.`));
    process.exit(1);
  }

  if (oursHash === theirsHash) {
    console.log(chalk.green('Already up to date.'));
    return;
  }

  // Check for fast-forward
  const mergeBase = findMergeBase(root, oursHash, theirsHash);

  if (mergeBase === oursHash) {
    // Fast-forward
    const head = refs.readHead(root);
    if (head.symbolic) {
      refs.updateRef(root, head.ref, theirsHash);
    } else {
      refs.writeHead(root, theirsHash);
    }

    // Update working tree
    const commit = objects.readCommit(root, theirsHash);
    checkoutTree(root, commit.tree);
    buildIndexFromTree(root, objects, commit.tree);

    console.log(chalk.green(`Fast-forward merge: ${oursHash.slice(0, 12)} → ${theirsHash.slice(0, 12)}`));
    return;
  }

  // Three-way merge
  const baseFiles = mergeBase ? getManifestMap(root, mergeBase) : new Map();
  const oursFiles = getManifestMap(root, oursHash);
  const theirsFiles = getManifestMap(root, theirsHash);

  const allPaths = new Set([...baseFiles.keys(), ...oursFiles.keys(), ...theirsFiles.keys()]);
  const mergedFiles = [];
  let hasConflicts = false;

  for (const filePath of allPaths) {
    const baseHash = baseFiles.get(filePath) || null;
    const oursFileHash = oursFiles.get(filePath) || null;
    const theirsFileHash = theirsFiles.get(filePath) || null;

    if (oursFileHash === theirsFileHash) {
      if (oursFileHash) mergedFiles.push({ path: filePath, hash: oursFileHash, mode: '100644' });
      continue;
    }

    if (oursFileHash === baseHash) {
      if (theirsFileHash) mergedFiles.push({ path: filePath, hash: theirsFileHash, mode: '100644' });
      continue;
    }
    if (theirsFileHash === baseHash) {
      if (oursFileHash) mergedFiles.push({ path: filePath, hash: oursFileHash, mode: '100644' });
      continue;
    }

    if (!oursFileHash || !theirsFileHash) {
      hasConflicts = true;
      console.log(chalk.red(`CONFLICT (delete/modify): ${filePath}`));
      const kept = oursFileHash || theirsFileHash;
      if (kept) mergedFiles.push({ path: filePath, hash: kept, mode: '100644' });
      continue;
    }

    // Both modified
    const baseContent = baseHash ? objects.readBlob(root, baseHash).toString('utf8') : '';
    const oursContent = objects.readBlob(root, oursFileHash).toString('utf8');
    const theirsContent = objects.readBlob(root, theirsFileHash).toString('utf8');

    const result = threeWayMerge(baseContent, oursContent, theirsContent);
    const mergedHash = objects.createBlob(root, result.merged);
    mergedFiles.push({ path: filePath, hash: mergedHash, mode: '100644' });

    if (result.hasConflicts) {
      hasConflicts = true;
      console.log(chalk.red(`CONFLICT (content): ${filePath}`));
    }
  }

  if (hasConflicts) {
    // Write conflicted files to working tree
    for (const file of mergedFiles) {
      const absPath = path.resolve(root, file.path);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
    }
    console.log(chalk.red('Automatic merge failed. Fix conflicts and commit.'));
    return;
  }

  // Build merged tree and create merge commit
  const treeHash = objects.buildTreeFromFiles(root, mergedFiles);
  const username = os.userInfo().username || 'user';
  const message = opts.message || `Merge branch '${branchName}' into ${currentBranch}`;

  const commitHash = objects.createCommit(root, {
    tree: treeHash,
    parents: [oursHash, theirsHash],
    authorName: username,
    authorEmail: `${username}@vpc`,
    message,
  });

  // Update branch ref
  const head = refs.readHead(root);
  if (head.symbolic) {
    refs.updateRef(root, head.ref, commitHash);
  } else {
    refs.writeHead(root, commitHash);
  }

  // Update working tree
  checkoutTree(root, treeHash);
  buildIndexFromTree(root, objects, treeHash);

  console.log(chalk.green(`Merge made: ${commitHash.slice(0, 12)} ${message}`));
}

function getManifestMap(root, commitHash) {
  const commit = objects.readCommit(root, commitHash);
  const manifest = objects.walkTree(root, commit.tree);
  return new Map(manifest.map(f => [f.path, f.hash]));
}

function checkoutTree(root, treeHash) {
  const manifest = objects.walkTree(root, treeHash);
  for (const file of manifest) {
    const absPath = path.resolve(root, file.path);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
  }
}

module.exports = { merge };
