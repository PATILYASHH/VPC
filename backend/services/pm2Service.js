const pm2 = require('pm2');

function connectPm2() {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function list() {
  try {
    await connectPm2();
    return new Promise((resolve, reject) => {
      pm2.list((err, list) => {
        pm2.disconnect();
        if (err) return reject(err);

        const processes = list.map((proc) => ({
          name: proc.name,
          pm_id: proc.pm_id,
          status: proc.pm2_env?.status || 'unknown',
          cpu: proc.monit?.cpu || 0,
          memory: proc.monit?.memory || 0,
          memory_mb: Math.round((proc.monit?.memory || 0) / 1024 / 1024),
          uptime: proc.pm2_env?.pm_uptime
            ? Date.now() - proc.pm2_env.pm_uptime
            : 0,
          restarts: proc.pm2_env?.restart_time || 0,
          pid: proc.pid,
        }));

        resolve(processes);
      });
    });
  } catch (err) {
    pm2.disconnect();
    throw err;
  }
}

async function restart(processName) {
  try {
    await connectPm2();
    return new Promise((resolve, reject) => {
      pm2.restart(processName, (err) => {
        pm2.disconnect();
        if (err) return reject(err);
        resolve({ success: true, message: `Process "${processName}" restarted` });
      });
    });
  } catch (err) {
    pm2.disconnect();
    throw err;
  }
}

async function getLogs(processName, lines = 50) {
  try {
    await connectPm2();
    return new Promise((resolve, reject) => {
      pm2.describe(processName, (err, desc) => {
        pm2.disconnect();
        if (err) return reject(err);
        if (!desc || desc.length === 0) return reject(new Error('Process not found'));

        const logFile = desc[0].pm2_env?.pm_out_log_path;
        const errLogFile = desc[0].pm2_env?.pm_err_log_path;

        resolve({
          logFile: logFile || null,
          errLogFile: errLogFile || null,
        });
      });
    });
  } catch (err) {
    pm2.disconnect();
    throw err;
  }
}

module.exports = { list, restart, getLogs };
