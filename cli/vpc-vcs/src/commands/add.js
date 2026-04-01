const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const objects = require('../core/objects');
const { stageFile, readIndex, writeIndex } = require('../core/index');

async function add(files, opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository. Run "vpc init" first.'));
    process.exit(1);
  }

  let filesToAdd = [];

  if (opts.all || (files.length === 1 && files[0] === '.')) {
    // Stage all changes
    filesToAdd = getAllFiles(root, root);

    // Also handle deletions: files in index but not on disk
    const index = readIndex(root);
    const existingPaths = new Set(filesToAdd);
    const deletedEntries = index.entries.filter(e => !existingPaths.has(e.path));
    for (const entry of deletedEntries) {
      // Remove from index
      index.entries = index.entries.filter(e => e.path !== entry.path);
    }
    if (deletedEntries.length > 0) {
      writeIndex(root, index);
    }
  } else if (files.length === 0) {
    console.log(chalk.yellow('Nothing specified. Use "vpc add <files>" or "vpc add -A" to stage all.'));
    return;
  } else {
    for (const file of files) {
      const absPath = path.resolve(file);
      const relPath = path.relative(root, absPath);

      if (fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
        filesToAdd.push(...getAllFiles(root, absPath));
      } else {
        filesToAdd.push(relPath);
      }
    }
  }

  let staged = 0;
  for (const filePath of filesToAdd) {
    const absPath = path.resolve(root, filePath);
    if (fs.existsSync(absPath)) {
      stageFile(root, filePath);
      staged++;
    } else {
      // File deleted — remove from index
      stageFile(root, filePath);
      staged++;
    }
  }

  console.log(chalk.green(`Staged ${staged} file(s)`));
}

function getAllFiles(root, dir) {
  const results = [];
  const ignorePatterns = ['.vpc', 'node_modules', '.git', '.DS_Store', '.env'];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignorePatterns.includes(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(path.relative(root, fullPath));
      }
    }
  }

  walk(dir);
  return results;
}

module.exports = { add };
