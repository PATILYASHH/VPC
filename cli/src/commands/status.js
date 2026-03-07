import ora from 'ora';
import chalk from 'chalk';
import { readConfig } from '../config.js';
import { fetchStatus } from '../api.js';

export async function statusCommand() {
  const config = readConfig();
  const spinner = ora('Fetching status...').start();

  try {
    const status = await fetchStatus(config);
    spinner.stop();

    console.log('');
    console.log(`  Project:    ${chalk.cyan(status.project.name)} (${status.project.slug})`);
    console.log(`  Tracking:   ${status.tracking_enabled ? chalk.green('enabled') : chalk.red('disabled')}`);
    console.log(`  Total:      ${chalk.dim(status.total_changes)} changes tracked`);
    console.log(`  Pending:    ${status.pending_changes > 0 ? chalk.yellow(status.pending_changes) : chalk.green('0')} changes`);
    console.log(`  Last pull:  ${status.last_pulled_at ? chalk.dim(new Date(status.last_pulled_at).toLocaleString()) : chalk.dim('never')}`);
    console.log('');

    if (status.pending_changes > 0) {
      console.log(`  Run ${chalk.cyan('vpc-pull pull')} to fetch pending changes.`);
      console.log('');
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}
