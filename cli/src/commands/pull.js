import fs from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { readConfig, writeConfig } from '../config.js';
import { fetchMigration, ackPull } from '../api.js';

export async function pullCommand(options) {
  const config = readConfig();
  const outDir = options.out || config.out || './migrations';
  const spinner = ora('Fetching schema changes...').start();

  try {
    const result = await fetchMigration(config);

    if (!result.migration) {
      spinner.succeed('No new changes since last pull');
      return;
    }

    spinner.text = `Found ${result.change_count} changes`;

    if (options.dryRun) {
      spinner.info(`Dry run — ${result.change_count} changes found (not written)`);
      console.log('');
      console.log(chalk.dim(result.migration.content));
      return;
    }

    // Ensure output directory exists
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Write migration file
    const filePath = path.join(outDir, result.migration.filename);
    fs.writeFileSync(filePath, result.migration.content);

    // Acknowledge the pull
    await ackPull(config, result.latest_id);

    // Update local config sequence
    config.lastPullSequence = result.latest_id;
    writeConfig(config);

    spinner.succeed(
      `Pulled ${result.change_count} changes → ${chalk.green(filePath)}`
    );

    if (result.has_more) {
      console.log(chalk.yellow('  More changes available. Run `vpc-pull pull` again.'));
    }
  } catch (err) {
    spinner.fail(err.message);
    process.exit(1);
  }
}
