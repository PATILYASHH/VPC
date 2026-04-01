const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const objects = require('../core/objects');
const refs = require('../core/refs');
const { readIndex } = require('../core/index');
const { diffLines } = require('../core/diff');

async function diff(opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  if (opts.staged) {
    // Show staged changes (index vs HEAD)
    showStagedDiff(root);
  } else {
    // Show unstaged changes (working tree vs index)
    showUnstagedDiff(root);
  }
}

function showStagedDiff(root) {
  const index = readIndex(root);
  const headHash = refs.resolveRef(root, 'HEAD');

  let headFiles = new Map();
  if (headHash) {
    const commit = objects.readCommit(root, headHash);
    const manifest = objects.walkTree(root, commit.tree);
    for (const f of manifest) headFiles.set(f.path, f.hash);
  }

  const indexMap = new Map(index.entries.map(e => [e.path, e.hash]));

  for (const [filePath, hash] of indexMap) {
    const oldHash = headFiles.get(filePath);
    if (oldHash === hash) continue; // No change

    const oldContent = oldHash ? objects.readBlob(root, oldHash).toString('utf8') : '';
    const newContent = objects.readBlob(root, hash).toString('utf8');

    printFileDiff(filePath, oldContent, newContent, !oldHash ? 'new' : 'modified');
  }

  for (const [filePath] of headFiles) {
    if (!indexMap.has(filePath)) {
      console.log(chalk.red(`--- a/${filePath}`));
      console.log(chalk.gray('(deleted)'));
      console.log();
    }
  }
}

function showUnstagedDiff(root) {
  const index = readIndex(root);

  for (const entry of index.entries) {
    const absPath = path.resolve(root, entry.path);
    if (!fs.existsSync(absPath)) {
      console.log(chalk.red(`deleted: ${entry.path}`));
      console.log();
      continue;
    }

    const currentContent = fs.readFileSync(absPath, 'utf8');
    const indexContent = objects.readBlob(root, entry.hash).toString('utf8');

    if (currentContent === indexContent) continue;

    printFileDiff(entry.path, indexContent, currentContent, 'modified');
  }
}

function printFileDiff(filePath, oldContent, newContent, status) {
  console.log(chalk.bold(`diff --vpc a/${filePath} b/${filePath}`));
  if (status === 'new') console.log(chalk.green('new file'));
  console.log(chalk.red(`--- a/${filePath}`));
  console.log(chalk.green(`+++ b/${filePath}`));

  const lines = diffLines(oldContent, newContent);
  for (const line of lines) {
    if (line.startsWith('+')) console.log(chalk.green(line));
    else if (line.startsWith('-')) console.log(chalk.red(line));
    else console.log(line);
  }
  console.log();
}

module.exports = { diff };
