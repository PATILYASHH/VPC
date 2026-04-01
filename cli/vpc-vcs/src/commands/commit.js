const chalk = require('chalk');
const os = require('os');
const objects = require('../core/objects');
const refs = require('../core/refs');
const { readIndex } = require('../core/index');

async function commit(opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  const index = readIndex(root);
  if (index.entries.length === 0) {
    console.log(chalk.yellow('Nothing to commit (empty index). Use "vpc add" first.'));
    return;
  }

  // Check if there are actual changes vs HEAD
  const headHash = refs.resolveRef(root, 'HEAD');
  if (headHash) {
    const headCommit = objects.readCommit(root, headHash);
    const headManifest = objects.walkTree(root, headCommit.tree);
    const headMap = new Map(headManifest.map(f => [f.path, f.hash]));
    const indexMap = new Map(index.entries.map(e => [e.path, e.hash]));

    let hasChanges = false;
    for (const [p, h] of indexMap) { if (headMap.get(p) !== h) { hasChanges = true; break; } }
    if (!hasChanges) {
      for (const [p] of headMap) { if (!indexMap.has(p)) { hasChanges = true; break; } }
    }

    if (!hasChanges) {
      console.log(chalk.yellow('Nothing to commit, working tree clean'));
      return;
    }
  }

  // Build tree from index
  const treeHash = objects.buildTreeFromFiles(root, index.entries);

  // Get author info
  const username = os.userInfo().username || 'user';
  const parents = headHash ? [headHash] : [];

  // Create commit
  const commitHash = objects.createCommit(root, {
    tree: treeHash,
    parents,
    authorName: username,
    authorEmail: `${username}@vpc`,
    message: opts.message,
  });

  // Update branch ref
  const head = refs.readHead(root);
  if (head.symbolic) {
    refs.updateRef(root, head.ref, commitHash);
  } else {
    refs.writeHead(root, commitHash);
  }

  const branch = refs.getCurrentBranch(root);
  console.log(chalk.green(`[${branch || 'detached'}] ${commitHash.slice(0, 12)} ${opts.message}`));
  console.log(chalk.gray(`  ${index.entries.length} file(s) in tree`));
}

module.exports = { commit };
