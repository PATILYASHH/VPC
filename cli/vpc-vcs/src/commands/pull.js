const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const objects = require('../core/objects');
const refs = require('../core/refs');
const remoteClient = require('../remote');
const { buildIndexFromTree } = require('../core/index');

async function pull(remoteName, branchName) {
  const root = objects.findRepoRoot();
  if (!root) {
    console.log(chalk.red('Not a VPC repository.'));
    process.exit(1);
  }

  remoteName = remoteName || 'origin';
  branchName = branchName || refs.getCurrentBranch(root);

  if (!branchName) {
    console.log(chalk.red('Not on a branch. Specify branch name.'));
    process.exit(1);
  }

  const remoteConfig = remoteClient.getRemote(root, remoteName);
  if (!remoteConfig) {
    console.log(chalk.red(`Remote '${remoteName}' not found.`));
    process.exit(1);
  }

  const spinner = ora('Pulling from remote...').start();

  try {
    // Get what we have locally
    const localHash = refs.resolveRef(root, `refs/heads/${branchName}`);
    const haves = localHash ? [localHash] : [];

    // Pull objects from remote
    spinner.text = 'Downloading objects...';
    const result = await remoteClient.pullObjects(remoteConfig, [`refs/heads/${branchName}`], haves);

    const remoteHash = result.refs[`refs/heads/${branchName}`];
    if (!remoteHash) {
      spinner.fail(`Branch '${branchName}' not found on remote.`);
      return;
    }

    if (remoteHash === localHash) {
      spinner.succeed('Already up to date.');
      return;
    }

    // Store received objects
    spinner.text = `Storing ${result.objects.length} object(s)...`;
    const vpcBase = objects.vpcDir(root);

    for (const obj of result.objects) {
      const objPath = path.join(vpcBase, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
      const dir = path.dirname(objPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(objPath)) {
        fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
      }
    }

    // Update remote tracking ref
    refs.updateRef(root, `refs/remotes/${remoteName}/${branchName}`, remoteHash);

    // Fast-forward merge if possible
    if (!localHash) {
      // First pull — just set branch
      refs.updateRef(root, `refs/heads/${branchName}`, remoteHash);
    } else {
      // Check if fast-forward is possible
      const isFF = isAncestor(root, localHash, remoteHash);
      if (isFF) {
        refs.updateRef(root, `refs/heads/${branchName}`, remoteHash);
      } else {
        spinner.warn('Remote has diverged. Manual merge needed.');
        spinner.succeed(`Fetched ${result.objects.length} object(s). Use "vpc merge" to integrate.`);
        return;
      }
    }

    // Update working tree
    spinner.text = 'Updating working tree...';
    const commit = objects.readCommit(root, remoteHash);
    const manifest = objects.walkTree(root, commit.tree);

    for (const file of manifest) {
      const absPath = path.resolve(root, file.path);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
    }

    // Update index
    buildIndexFromTree(root, objects, commit.tree);

    spinner.succeed(`Pulled ${result.objects.length} object(s). Now at ${remoteHash.slice(0, 12)}`);

  } catch (err) {
    spinner.fail(`Pull failed: ${err.message}`);
    process.exit(1);
  }
}

function isAncestor(root, ancestorHash, descendantHash) {
  const visited = new Set();
  const queue = [descendantHash];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (hash === ancestorHash) return true;
    if (visited.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = objects.readCommit(root, hash);
      for (const parent of commit.parents) {
        if (!visited.has(parent)) queue.push(parent);
      }
    } catch { break; }
  }
  return false;
}

module.exports = { pull };
