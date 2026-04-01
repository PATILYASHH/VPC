const chalk = require('chalk');
const objects = require('../core/objects');
const remoteClient = require('../remote');

async function remote(action, name, url) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  if (!action || action === 'list') {
    const config = remoteClient.readConfig(root);
    const remotes = Object.entries(config.remotes || {});
    if (remotes.length === 0) {
      console.log(chalk.yellow('No remotes configured.'));
      return;
    }
    for (const [remoteName, remote] of remotes) {
      console.log(`${chalk.green(remoteName)}\t${remote.url}`);
    }
    return;
  }

  if (action === 'add') {
    if (!name || !url) {
      console.log(chalk.red('Usage: vpc remote add <name> <url>'));
      process.exit(1);
    }

    const existing = remoteClient.getRemote(root, name);
    if (existing) {
      console.log(chalk.red(`Remote '${name}' already exists.`));
      process.exit(1);
    }

    // Parse authentication from URL or ask later
    remoteClient.setRemote(root, name, url, '', '');
    console.log(chalk.green(`Added remote '${name}': ${url}`));
    return;
  }

  if (action === 'remove' || action === 'rm') {
    if (!name) {
      console.log(chalk.red('Usage: vpc remote remove <name>'));
      process.exit(1);
    }
    remoteClient.removeRemote(root, name);
    console.log(chalk.green(`Removed remote '${name}'`));
    return;
  }

  if (action === 'set-url') {
    if (!name || !url) {
      console.log(chalk.red('Usage: vpc remote set-url <name> <url>'));
      process.exit(1);
    }
    const existing = remoteClient.getRemote(root, name);
    if (!existing) {
      console.log(chalk.red(`Remote '${name}' not found.`));
      process.exit(1);
    }
    remoteClient.setRemote(root, name, url, existing.username, existing.token);
    console.log(chalk.green(`Updated URL for '${name}': ${url}`));
    return;
  }

  if (action === 'set-token') {
    if (!name || !url) {
      console.log(chalk.red('Usage: vpc remote set-token <name> <token>'));
      process.exit(1);
    }
    const existing = remoteClient.getRemote(root, name);
    if (!existing) {
      console.log(chalk.red(`Remote '${name}' not found.`));
      process.exit(1);
    }
    remoteClient.setRemote(root, name, existing.url, existing.username || '', url /* token */);
    console.log(chalk.green(`Updated token for '${name}'`));
    return;
  }

  console.log(chalk.red(`Unknown action '${action}'. Use: add, remove, list, set-url, set-token`));
}

module.exports = { remote };
