const os = require('os');
const { execFile } = require('child_process');

function getMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  // Calculate CPU usage from idle percentages
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  const cpuPercent = Math.round(((totalTick - totalIdle) / totalTick) * 100);

  return {
    cpu_percent: cpuPercent,
    cpu_count: cpus.length,
    memory_used_mb: Math.round((totalMem - freeMem) / 1024 / 1024),
    memory_total_mb: Math.round(totalMem / 1024 / 1024),
    memory_percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    uptime_seconds: os.uptime(),
    load_avg: os.loadavg(),
    platform: os.platform(),
    hostname: os.hostname(),
  };
}

function restartSystemService(serviceName) {
  return new Promise((resolve, reject) => {
    execFile(
      'systemctl',
      ['restart', serviceName],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`Failed to restart ${serviceName}: ${err.message}`));
        resolve({ success: true, message: `Service "${serviceName}" restarted` });
      }
    );
  });
}

function getDiskUsage() {
  return new Promise((resolve, reject) => {
    execFile('df', ['-h', '--output=source,size,used,avail,pcent,target'], { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);

      const lines = stdout.trim().split('\n').slice(1);
      const disks = lines
        .filter((line) => line.startsWith('/'))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            use_percent: parts[4],
            mount: parts[5],
          };
        });

      resolve(disks);
    });
  });
}

module.exports = { getMetrics, restartSystemService, getDiskUsage };
