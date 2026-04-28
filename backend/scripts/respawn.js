// Tiny detached helper that re-launches VPC after the parent exits.
// Used for the case where VPC was started with plain `node app.js` (no PM2,
// no nodemon, no systemd). Under nodemon/PM2 this script is a no-op safety net.
//
// Args: [parentPid, rootDir]

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const parentPid = parseInt(process.argv[2] || '0', 10);
const rootDir = process.argv[3] || path.resolve(__dirname, '..', '..');
const isWin = process.platform === 'win32';

function isRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

(async () => {
  // Wait for parent to actually exit (max 10s)
  for (let i = 0; i < 50 && isRunning(parentPid); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // If something else (nodemon/PM2) already restarted us, the port will be taken.
  // We still try; the spawned process will exit fast on EADDRINUSE without harm.

  // Pick the start script. Prefer `npm run dev` if package.json + node_modules exist
  // (so concurrently/nodemon/vite all come back up together).
  const pkgPath = path.join(rootDir, 'package.json');
  let cmd, args;
  if (isWin) {
    if (fs.existsSync(pkgPath)) {
      cmd = 'cmd.exe';
      args = ['/c', 'start', '""', '/min', 'cmd.exe', '/c', 'npm', 'run', 'dev'];
    } else {
      cmd = 'cmd.exe';
      args = ['/c', 'start', '""', '/min', 'node', 'app.js'];
    }
  } else {
    cmd = fs.existsSync(pkgPath) ? 'npm' : process.execPath;
    args = fs.existsSync(pkgPath) ? ['run', 'dev'] : ['app.js'];
  }

  try {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: isWin,
    });
    child.unref();
  } catch (err) {
    // Best effort — log to file since this is detached
    try {
      fs.appendFileSync(path.join(rootDir, '.vpc-respawn.log'),
        `[${new Date().toISOString()}] respawn failed: ${err.message}\n`);
    } catch {}
  }

  process.exit(0);
})();
