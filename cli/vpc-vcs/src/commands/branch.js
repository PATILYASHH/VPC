const chalk = require('chalk');
const objects = require('../core/objects');
const refs = require('../core/refs');

async function branch(name, opts) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  if (opts.delete && name) {
    // Delete branch
    const currentBranch = refs.getCurrentBranch(root);
    if (name === currentBranch) {
      console.log(chalk.red(`Cannot delete current branch '${name}'.`));
      process.exit(1);
    }
    const hash = refs.resolveRef(root, `refs/heads/${name}`);
    if (!hash) {
      console.log(chalk.red(`Branch '${name}' not found.`));
      process.exit(1);
    }
    refs.deleteRef(root, `refs/heads/${name}`);
    console.log(chalk.green(`Deleted branch '${name}' (was ${hash.slice(0, 12)}).`));
    return;
  }

  if (name) {
    // Create new branch
    const headHash = refs.resolveRef(root, 'HEAD');
    if (!headHash) {
      console.log(chalk.red('Cannot create branch: no commits yet.'));
      process.exit(1);
    }

    const existing = refs.resolveRef(root, `refs/heads/${name}`);
    if (existing) {
      console.log(chalk.red(`Branch '${name}' already exists.`));
      process.exit(1);
    }

    refs.updateRef(root, `refs/heads/${name}`, headHash);
    console.log(chalk.green(`Created branch '${name}' at ${headHash.slice(0, 12)}`));
    return;
  }

  // List branches
  const branches = refs.listBranches(root);
  const currentBranch = refs.getCurrentBranch(root);

  if (branches.length === 0) {
    console.log(chalk.yellow('No branches yet.'));
    return;
  }

  for (const b of branches) {
    const isCurrent = b.name === currentBranch;
    const prefix = isCurrent ? '* ' : '  ';
    const color = isCurrent ? chalk.green : chalk.white;
    console.log(color(`${prefix}${b.name}`) + chalk.gray(` ${b.hash.slice(0, 12)}`));
  }
}

module.exports = { branch };
