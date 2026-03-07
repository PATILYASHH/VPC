import fs from 'fs';
import path from 'path';

const CONFIG_FILE = '.vpcpull';

export function readConfig() {
  const configPath = path.join(process.cwd(), CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error('No .vpcpull config found. Run `vpc-pull init` first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function writeConfig(config) {
  const configPath = path.join(process.cwd(), CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
