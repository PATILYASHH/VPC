const chalk = require('chalk');
const objects = require('../core/objects');
const refs = require('../core/refs');

async function log(opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  const headHash = refs.resolveRef(root, 'HEAD');
  if (!headHash) {
    console.log(chalk.yellow('No commits yet.'));
    return;
  }

  const limit = parseInt(opts.number) || 10;
  const visited = new Set();
  const queue = [headHash];
  let count = 0;

  while (queue.length > 0 && count < limit) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = objects.readCommit(root, hash);
      const date = commit.authorDate
        ? new Date(commit.authorDate * 1000).toISOString().replace('T', ' ').slice(0, 19)
        : 'unknown';

      console.log(chalk.yellow(`commit ${commit.hash}`));
      console.log(`Author: ${commit.authorName} <${commit.authorEmail}>`);
      console.log(`Date:   ${date}`);
      console.log();
      console.log(`    ${commit.message}`);
      if (commit.body) console.log(`    ${commit.body}`);
      console.log();

      count++;

      for (const parent of commit.parents) {
        if (!visited.has(parent)) queue.push(parent);
      }
    } catch { break; }
  }
}

module.exports = { log };
