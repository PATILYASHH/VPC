const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const objects = require('../core/objects');
const refs = require('../core/refs');
const { readIndex, isFileModified } = require('../core/index');

async function status() {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  const branch = refs.getCurrentBranch(root);
  console.log(chalk.bold(`On branch ${branch || '(detached HEAD)'}`));
  console.log();

  const index = readIndex(root);
  const headHash = refs.resolveRef(root, 'HEAD');

  // Get HEAD tree manifest
  let headFiles = new Map();
  if (headHash) {
    try {
      const commit = objects.readCommit(root, headHash);
      const manifest = objects.walkTree(root, commit.tree);
      for (const f of manifest) headFiles.set(f.path, f.hash);
    } catch { /* empty repo */ }
  }

  // Compare index vs HEAD (staged changes)
  const staged = [];
  const indexMap = new Map();
  for (const entry of index.entries) {
    indexMap.set(entry.path, entry.hash);
    const headHash = headFiles.get(entry.path);
    if (!headHash) {
      staged.push({ path: entry.path, status: 'new file' });
    } else if (headHash !== entry.hash) {
      staged.push({ path: entry.path, status: 'modified' });
    }
  }
  // Check for deleted files (in HEAD but not in index)
  for (const [filePath] of headFiles) {
    if (!indexMap.has(filePath)) {
      staged.push({ path: filePath, status: 'deleted' });
    }
  }

  // Compare working tree vs index (unstaged changes)
  const unstaged = [];
  const untracked = [];

  // Check index entries against working tree
  for (const entry of index.entries) {
    const absPath = path.resolve(root, entry.path);
    if (!fs.existsSync(absPath)) {
      unstaged.push({ path: entry.path, status: 'deleted' });
    } else if (isFileModified(root, entry.path)) {
      unstaged.push({ path: entry.path, status: 'modified' });
    }
  }

  // Find untracked files
  const allFiles = getAllFiles(root);
  for (const filePath of allFiles) {
    if (!indexMap.has(filePath) && !headFiles.has(filePath)) {
      untracked.push(filePath);
    }
  }

  // Print staged changes
  if (staged.length > 0) {
    console.log(chalk.green('Changes to be committed:'));
    for (const s of staged) {
      console.log(chalk.green(`  ${s.status}: ${s.path}`));
    }
    console.log();
  }

  // Print unstaged changes
  if (unstaged.length > 0) {
    console.log(chalk.red('Changes not staged for commit:'));
    for (const u of unstaged) {
      console.log(chalk.red(`  ${u.status}: ${u.path}`));
    }
    console.log();
  }

  // Print untracked
  if (untracked.length > 0) {
    console.log(chalk.gray('Untracked files:'));
    for (const u of untracked.slice(0, 20)) {
      console.log(chalk.gray(`  ${u}`));
    }
    if (untracked.length > 20) {
      console.log(chalk.gray(`  ... and ${untracked.length - 20} more`));
    }
    console.log();
  }

  if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
    console.log(chalk.gray('Nothing to commit, working tree clean'));
  }
}

function getAllFiles(root) {
  const results = [];
  const ignorePatterns = ['.vpc', 'node_modules', '.git', '.DS_Store', '.env'];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else results.push(path.relative(root, fullPath));
    }
  }
  walk(root);
  return results;
}

module.exports = { status };
