const chalk = require('chalk');
const ora = require('ora');
const objects = require('../core/objects');
const refs = require('../core/refs');
const remote = require('../remote');

async function push(remoteName, branchName) {
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

  const remoteConfig = remote.getRemote(root, remoteName);
  if (!remoteConfig) {
    console.log(chalk.red(`Remote '${remoteName}' not found. Use "vpc remote add ${remoteName} <url>"`));
    process.exit(1);
  }

  const spinner = ora('Pushing to remote...').start();

  try {
    // Get local ref
    const localHash = refs.resolveRef(root, `refs/heads/${branchName}`);
    if (!localHash) {
      spinner.fail(`Branch '${branchName}' has no commits.`);
      return;
    }

    // Get remote refs
    spinner.text = 'Fetching remote refs...';
    const remoteRefs = await remote.fetchRefs(remoteConfig);
    const remoteHash = remoteRefs.refs[`refs/heads/${branchName}`] || '0'.repeat(64);

    if (remoteHash === localHash) {
      spinner.succeed('Already up to date.');
      return;
    }

    // Collect objects to send
    spinner.text = 'Collecting objects...';
    const remoteObjects = new Set();
    if (remoteHash !== '0'.repeat(64)) {
      // Collect all objects the remote already has
      // We approximate by using the remote tracking ref
      const trackingHash = refs.resolveRef(root, `refs/remotes/${remoteName}/${branchName}`);
      if (trackingHash) {
        collectReachable(root, trackingHash, remoteObjects);
      }
    }

    const localObjects = new Set();
    collectReachable(root, localHash, localObjects);

    // Objects to send = local minus remote
    const toSend = [];
    for (const hash of localObjects) {
      if (!remoteObjects.has(hash)) {
        try {
          const rawCompressed = objects.readObjectRaw(root, hash);
          const obj = objects.readObject(root, hash);
          toSend.push({
            hash,
            type: obj.type,
            data: rawCompressed.toString('base64'),
            compressed: true,
          });
        } catch { /* skip */ }
      }
    }

    spinner.text = `Pushing ${toSend.length} object(s)...`;

    // Push objects and update refs (send old hash for optimistic locking)
    const result = await remote.pushObjects(remoteConfig, toSend, {
      [`refs/heads/${branchName}`]: { old: remoteHash, new: localHash },
    });

    if (result.conflict && result.auto_pr) {
      spinner.warn(`Merge conflicts detected. PR #${result.auto_pr.pr_number} created automatically.`);
      console.log(chalk.yellow(`  Conflicting files: ${result.auto_pr.conflicts.join(', ')}`));
      console.log(chalk.cyan(`  Resolve conflicts and merge the PR on VPSHub.`));
      return;
    }

    if (!result.ok && !result.merged) {
      spinner.fail(`Push failed: ${result.error || 'Unknown error'}`);
      return;
    }

    // Update remote tracking ref
    const finalHash = result.merged ? (result.updated_refs?.[`refs/heads/${branchName}`] || localHash) : localHash;
    refs.updateRef(root, `refs/remotes/${remoteName}/${branchName}`, finalHash);

    if (result.merged) {
      spinner.succeed(`Pushed with auto-merge to ${remoteName}/${branchName} (${finalHash.slice(0, 12)})`);
    } else {
      spinner.succeed(`Pushed ${toSend.length} object(s) to ${remoteName}/${branchName} (${localHash.slice(0, 12)})`);
    }

  } catch (err) {
    spinner.fail(`Push failed: ${err.message}`);
    process.exit(1);
  }
}

function collectReachable(root, commitHash, objectSet) {
  const queue = [commitHash];
  const visited = new Set();

  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || visited.has(hash)) continue;
    visited.add(hash);
    objectSet.add(hash);

    try {
      const obj = objects.readObject(root, hash);
      if (obj.type === 'commit') {
        const commit = objects.readCommit(root, hash);
        objectSet.add(commit.tree);
        collectTreeObjects(root, commit.tree, objectSet);
        for (const parent of commit.parents) {
          if (!visited.has(parent)) queue.push(parent);
        }
      }
    } catch { /* end */ }
  }
}

function collectTreeObjects(root, treeHash, objectSet) {
  if (objectSet.has(treeHash)) return;
  objectSet.add(treeHash);
  try {
    const entries = objects.readTree(root, treeHash);
    for (const entry of entries) {
      if (entry.type === 'tree') {
        collectTreeObjects(root, entry.hash, objectSet);
      } else {
        objectSet.add(entry.hash);
      }
    }
  } catch { /* ignore */ }
}

module.exports = { push };
