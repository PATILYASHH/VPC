/**
 * Upgrade state — knows what commit the running process booted from
 * vs what's on disk right now. Surfaces drift so the UI can nudge for
 * a hard restart and the auto-upgrader can verify its pull actually landed.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Captured once at boot — the commit the currently-running code was loaded from.
// Stays fixed for the lifetime of this Node process.
let BOOT_COMMIT = null;
let BOOT_BRANCH = null;
let BOOT_AT = null;

function gitSync(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', timeout }).trim();
  } catch { return null; }
}

function captureBoot() {
  if (BOOT_COMMIT) return; // already captured
  BOOT_COMMIT = process.env.VPC_BOOT_COMMIT || gitSync('git rev-parse HEAD');
  BOOT_BRANCH = process.env.VPC_BOOT_BRANCH || gitSync('git rev-parse --abbrev-ref HEAD');
  BOOT_AT = new Date().toISOString();
}

function currentOnDisk() {
  return {
    commit: gitSync('git rev-parse HEAD'),
    branch: gitSync('git rev-parse --abbrev-ref HEAD'),
  };
}

async function status(pool) {
  captureBoot();
  const onDisk = currentOnDisk();
  const needsRestart = !!(BOOT_COMMIT && onDisk.commit && BOOT_COMMIT !== onDisk.commit);

  // Is origin ahead of what we have on disk?
  let remoteAhead = 0;
  try {
    const count = gitSync(`git rev-list HEAD..origin/${onDisk.branch || 'main'} --count`, 3000);
    remoteAhead = parseInt(count || '0', 10) || 0;
  } catch { /* network/refs unavailable */ }

  // Pending flag set by the auto-upgrader in app.js
  let pendingInfo = null;
  try {
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'upgrade_pending_restart'");
    if (rows[0]?.value) {
      try { pendingInfo = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value; }
      catch { pendingInfo = { raw: rows[0].value }; }
    }
  } catch { /* table may not exist on first boot */ }

  const frontendBuildAt = (() => {
    try {
      const idx = path.join(ROOT_DIR, 'frontend', 'dist', 'index.html');
      return fs.existsSync(idx) ? fs.statSync(idx).mtime.toISOString() : null;
    } catch { return null; }
  })();

  return {
    running: {
      commit: BOOT_COMMIT,
      commit_short: BOOT_COMMIT?.slice(0, 7) || null,
      branch: BOOT_BRANCH,
      booted_at: BOOT_AT,
    },
    on_disk: {
      commit: onDisk.commit,
      commit_short: onDisk.commit?.slice(0, 7) || null,
      branch: onDisk.branch,
    },
    frontend_build_at: frontendBuildAt,
    needs_restart: needsRestart,
    remote_ahead: remoteAhead,
    pending_restart: pendingInfo,
    pid: process.pid,
  };
}

// Soft restart — exits the process so PM2/systemd/nodemon relaunches it
// with the fresh code on disk. Returns a promise so we can respond first.
function requestRestart({ delayMs = 400 } = {}) {
  setTimeout(() => {
    console.log('[upgrade] restart requested — using triggerRestart()');
    try {
      // Reuse the robust restart logic in the vpshub route module
      const { triggerRestart } = require('../routes/vpshub');
      if (typeof triggerRestart === 'function') return triggerRestart();
    } catch {}
    // Fallback — exit non-zero so nodemon picks it up
    process.exit(1);
  }, delayMs);
}

// Clear the pending-restart marker (called by the UI once the user has restarted)
async function clearPending(pool) {
  try {
    await pool.query("DELETE FROM vpc_settings WHERE key = 'upgrade_pending_restart'");
  } catch { /* non-fatal */ }
}

// Utility for the auto-upgrader in app.js — asserts that git pull moved HEAD.
// Returns the new commit hash, or throws if HEAD didn't actually change.
function assertHeadMoved(expectedPrevHash) {
  const now = gitSync('git rev-parse HEAD');
  if (!now) throw new Error('Could not read HEAD after upgrade');
  if (expectedPrevHash && now === expectedPrevHash) {
    throw new Error(`Upgrade did not land: HEAD still at ${now.slice(0, 7)}. Check for merge conflicts or uncommitted changes.`);
  }
  return now;
}

module.exports = {
  captureBoot,
  status,
  requestRestart,
  clearPending,
  assertHeadMoved,
  ROOT_DIR,
  get BOOT_COMMIT() { return BOOT_COMMIT; },
};
