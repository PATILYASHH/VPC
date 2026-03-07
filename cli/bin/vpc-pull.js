#!/usr/bin/env node
import { program } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { pullCommand } from '../src/commands/pull.js';
import { statusCommand } from '../src/commands/status.js';

program
  .name('vpc-pull')
  .description('Pull schema migrations from BanaDB')
  .version('1.0.0');

program
  .command('init')
  .description('Configure connection to a BanaDB project')
  .requiredOption('--url <url>', 'BanaDB project API URL (e.g. https://server/api/bana/v1/my-project)')
  .requiredOption('--key <key>', 'Pull API key (starts with bana_pull_)')
  .option('--out <dir>', 'Output directory for migration files', './migrations')
  .action(initCommand);

program
  .command('pull')
  .description('Pull new schema changes as a migration file')
  .option('--out <dir>', 'Output directory (overrides config)')
  .option('--dry-run', 'Show changes without writing files')
  .action(pullCommand);

program
  .command('status')
  .description('Show pull status and pending changes')
  .action(statusCommand);

program.parse();
