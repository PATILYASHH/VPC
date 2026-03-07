import chalk from 'chalk';
import { writeConfig } from '../config.js';

export async function initCommand(options) {
  const { url, key, out } = options;

  if (!url.includes('/api/bana/v1/')) {
    console.error(chalk.red('URL must include /api/bana/v1/<project-slug>'));
    process.exit(1);
  }

  if (!key.startsWith('bana_pull_')) {
    console.warn(chalk.yellow('Warning: Key does not start with bana_pull_ — are you sure this is a pull key?'));
  }

  const config = { url, key, out, lastPullSequence: 0 };
  writeConfig(config);

  console.log(chalk.green('Configuration saved to .vpcpull'));
  console.log('');
  console.log(`  URL:    ${chalk.dim(url)}`);
  console.log(`  Key:    ${chalk.dim(key.slice(0, 20))}...`);
  console.log(`  Output: ${chalk.dim(out)}`);
  console.log('');
  console.log(`Run ${chalk.cyan('vpc-pull pull')} to fetch schema changes.`);
}
