const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const objects = require('../core/objects');
const refs = require('../core/refs');
const remoteClient = require('../remote');
const { buildIndexFromTree } = require('../core/index');

async function clone(url, opts) {
  // Parse URL to get owner/repo
  // URL format: https://host/vcs/owner/repo
  const urlParts = url.replace(/\/$/, '').split('/');
  const repoName = urlParts[urlParts.length - 1].replace(/\.vpc$/, '');
  const targetDir = opts.dir || repoName;
  const absDir = path.resolve(targetDir);

  if (fs.existsSync(absDir) && fs.readdirSync(absDir).length > 0) {
    console.log(chalk.red(`Directory '${targetDir}' already exists and is not empty.`));
    process.exit(1);
  }

  const spinner = ora(`Cloning into '${targetDir}'...`).start();

  try {
    // Create directory
    if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

    // Init .vpc structure
    const vpcPath = path.join(absDir, '.vpc');
    fs.mkdirSync(path.join(vpcPath, 'objects'), { recursive: true });
    fs.mkdirSync(path.join(vpcPath, 'refs', 'heads'), { recursive: true });
    fs.mkdirSync(path.join(vpcPath, 'refs', 'tags'), { recursive: true });
    fs.mkdirSync(path.join(vpcPath, 'refs', 'remotes', 'origin'), { recursive: true });
    fs.writeFileSync(path.join(vpcPath, 'HEAD'), 'ref: refs/heads/main\n');
    fs.writeFileSync(path.join(vpcPath, 'index'), JSON.stringify({ entries: [] }, null, 2));

    // Ask for credentials (from URL or prompt)
    const username = opts.username || '';
    const token = opts.token || '';

    // Save remote config
    const config = {
      remotes: {
        origin: { url, username, token },
      },
    };
    fs.writeFileSync(path.join(vpcPath, 'config'), JSON.stringify(config, null, 2));

    // Fetch refs
    spinner.text = 'Fetching remote refs...';
    const remoteConfig = config.remotes.origin;
    const remoteRefs = await remoteClient.fetchRefs(remoteConfig);

    if (!remoteRefs.HEAD) {
      spinner.succeed('Cloned empty repository.');
      return;
    }

    // Pull all objects
    spinner.text = 'Downloading objects...';
    const allRefNames = Object.keys(remoteRefs.refs);
    const result = await remoteClient.pullObjects(remoteConfig, allRefNames, []);

    // Store objects
    spinner.text = `Storing ${result.objects.length} object(s)...`;
    for (const obj of result.objects) {
      const objPath = path.join(vpcPath, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
      const dir = path.dirname(objPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
    }

    // Set up refs
    for (const [refName, hash] of Object.entries(result.refs)) {
      const shortName = refName.replace('refs/heads/', '').replace('refs/tags/', '');

      // Set remote tracking refs
      if (refName.startsWith('refs/heads/')) {
        refs.updateRef(absDir, `refs/remotes/origin/${shortName}`, hash);
      }
    }

    // Set default branch
    const defaultBranch = remoteRefs.defaultBranch || 'main';
    const defaultHash = remoteRefs.refs[`refs/heads/${defaultBranch}`] || remoteRefs.HEAD;

    if (defaultHash) {
      refs.updateRef(absDir, `refs/heads/${defaultBranch}`, defaultHash);
      refs.writeHead(absDir, `refs/heads/${defaultBranch}`);

      // Checkout working tree
      spinner.text = 'Checking out files...';
      const commit = objects.readCommit(absDir, defaultHash);
      const manifest = objects.walkTree(absDir, commit.tree);

      for (const file of manifest) {
        const filePath = path.resolve(absDir, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, objects.readBlob(absDir, file.hash));
      }

      // Build index
      buildIndexFromTree(absDir, objects, commit.tree);
    }

    spinner.succeed(`Cloned into '${targetDir}' (${result.objects.length} objects, branch: ${defaultBranch})`);

  } catch (err) {
    spinner.fail(`Clone failed: ${err.message}`);
    // Clean up on failure
    if (fs.existsSync(absDir)) {
      try { fs.rmSync(absDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    process.exit(1);
  }
}

module.exports = { clone };
