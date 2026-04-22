/**
 * Backup scheduler — polls vpc_backup_destinations every minute and runs any
 * destinations whose next_run_at has elapsed. Runs are sequential per tick to
 * avoid contention on pg_dump.
 */

const supabaseBackup = require('./supabaseBackupService');

let timer = null;
let running = false;
const POLL_MS = 60 * 1000;

async function tick(pool) {
  if (running) return;
  running = true;
  try {
    const due = await supabaseBackup.dueDestinations(pool);
    for (const dest of due) {
      try {
        if (dest.provider === 'supabase') {
          console.log(`[backupScheduler] running supabase destination "${dest.name}" (${dest.id})`);
          await supabaseBackup.runDestination(pool, dest.id, {});
        } else {
          console.warn(`[backupScheduler] unknown provider: ${dest.provider}`);
        }
      } catch (err) {
        console.error(`[backupScheduler] destination ${dest.id} failed:`, err.message);
      }
    }
  } catch (err) {
    console.error('[backupScheduler] tick error:', err.message);
  } finally {
    running = false;
  }
}

function start(pool) {
  if (timer) return;
  // Kick after 30s so the app is fully up, then poll every minute
  setTimeout(() => { tick(pool); }, 30_000);
  timer = setInterval(() => tick(pool), POLL_MS);
  console.log('[backupScheduler] started (poll every 60s)');
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };
