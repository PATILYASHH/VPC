const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

async function init() {
  const root = process.cwd();
  const vpcPath = path.join(root, '.vpc');

  if (fs.existsSync(vpcPath)) {
    console.log(chalk.yellow('VPC repository already initialized.'));
    return;
  }

  fs.mkdirSync(path.join(vpcPath, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(vpcPath, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(path.join(vpcPath, 'refs', 'tags'), { recursive: true });
  fs.mkdirSync(path.join(vpcPath, 'refs', 'remotes', 'origin'), { recursive: true });
  fs.writeFileSync(path.join(vpcPath, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(vpcPath, 'config'), JSON.stringify({ remotes: {} }, null, 2));
  fs.writeFileSync(path.join(vpcPath, 'index'), JSON.stringify({ entries: [] }, null, 2));

  console.log(chalk.green(`Initialized empty VPC repository in ${vpcPath}`));
}

module.exports = { init };
