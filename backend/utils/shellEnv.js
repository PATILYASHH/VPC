// Build an environment with PATH augmented to include common locations for
// CLI tools installed AFTER the Node process started (npm globals, winget, pip, etc).
// Without this, tools like `claude`, `tsc`, `vercel` aren't visible to spawn/exec.

const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

let cached = null;
let cachedAt = 0;
const CACHE_MS = 30_000; // re-probe every 30s so freshly installed tools appear quickly

function buildAugmentedEnv() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) return cached;

  const env = { ...process.env };
  const extras = [];
  const isWin = process.platform === 'win32';

  // npm global bin — where `claude`, etc. land after `npm i -g`
  try {
    const npmPrefix = execSync('npm config get prefix', { timeout: 5000, windowsHide: true }).toString().trim();
    if (npmPrefix) {
      extras.push(npmPrefix);                   // Windows: bins live directly here
      extras.push(path.join(npmPrefix, 'bin')); // Linux/macOS
    }
  } catch {}

  if (isWin) {
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    if (appData) extras.push(path.join(appData, 'npm'));
    if (localAppData) {
      extras.push(path.join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'));
      extras.push(path.join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'));
      extras.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links'));
    }
  } else {
    extras.push('/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.local', 'bin'));
  }

  const sep = isWin ? ';' : ':';
  const existing = env.PATH || env.Path || '';
  const existingSet = new Set(existing.split(sep).filter(Boolean));
  const newPath = [...extras.filter((p) => p && !existingSet.has(p)), existing].join(sep);
  env.PATH = newPath;
  if (isWin) env.Path = newPath; // Windows is case-insensitive but Node spawn cares about exact key

  cached = env;
  cachedAt = now;
  return env;
}

function invalidate() { cached = null; }

module.exports = { buildAugmentedEnv, invalidate };
