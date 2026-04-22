/**
 * `vpc-pull login` — GitHub-style browser sign-in.
 * Pops open the VPC approval page, polls for the PAT, writes it to .vpcpull.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import { writeConfig } from '../config.js';

const USER_HOME_CONFIG = path.join(os.homedir(), '.vpc', 'auth.json');

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { status: res.status, data };
}

export async function loginCommand(opts = {}) {
  const server = (opts.server || 'http://localhost:8001').replace(/\/+$/, '');
  const spinner = ora(`Requesting device code from ${server}…`).start();

  const { status, data } = await postJson(`${server}/api/admin/auth/device/code`, {
    client_name: 'VPC CLI',
  });
  if (status !== 200) {
    spinner.fail(`Server returned HTTP ${status}: ${data?.error || 'unknown'}`);
    process.exit(1);
  }

  const { device_code, user_code, verification_uri_complete, expires_in, interval } = data;
  spinner.succeed(`Got code ${chalk.bold(user_code)}`);

  console.log();
  console.log(`  ${chalk.dim('Open this URL in your browser:')}`);
  console.log(`    ${chalk.cyan.underline(verification_uri_complete)}`);
  console.log();
  console.log(`  ${chalk.dim('Or enter this code manually:')}`);
  console.log(`    ${chalk.bold.cyan(user_code)}`);
  console.log();

  openBrowser(verification_uri_complete);

  const pollSpinner = ora('Waiting for approval in your browser…').start();
  const deadline = Date.now() + expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, (interval || 3) * 1000));
    const poll = await postJson(`${server}/api/admin/auth/device/token`, { device_code });

    if (poll.status === 200) {
      pollSpinner.succeed(`Signed in as ${chalk.bold(poll.data.username)}`);
      // Persist to ~/.vpc/auth.json (global) and create .vpcpull in cwd
      fs.mkdirSync(path.dirname(USER_HOME_CONFIG), { recursive: true });
      fs.writeFileSync(USER_HOME_CONFIG, JSON.stringify({
        server_url: poll.data.server_url || server,
        username: poll.data.username,
        token: poll.data.access_token,
        signed_in_at: new Date().toISOString(),
      }, null, 2) + '\n');

      try {
        writeConfig({
          server_url: poll.data.server_url || server,
          username: poll.data.username,
          token: poll.data.access_token,
        });
        console.log(`  ${chalk.dim('Saved credentials to .vpcpull and')} ${chalk.dim(USER_HOME_CONFIG)}`);
      } catch {
        console.log(`  ${chalk.dim('Saved credentials to')} ${chalk.dim(USER_HOME_CONFIG)}`);
      }
      return;
    }
    if (poll.status === 202) continue; // pending
    if (poll.status === 410) { pollSpinner.fail('Device code expired'); process.exit(1); }
    if (poll.status === 403) { pollSpinner.fail('Authorization denied'); process.exit(1); }
    pollSpinner.fail(`Poll error: ${poll.data?.error || poll.status}`);
    process.exit(1);
  }
  pollSpinner.fail('Timed out waiting for approval');
  process.exit(1);
}

export function readGlobalAuth() {
  if (!fs.existsSync(USER_HOME_CONFIG)) return null;
  try { return JSON.parse(fs.readFileSync(USER_HOME_CONFIG, 'utf8')); } catch { return null; }
}
