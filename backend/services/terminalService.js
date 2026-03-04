const os = require('os');
const { execFile } = require('child_process');
const pm2Service = require('./pm2Service');

// Map vpc commands to actual system operations
async function execute(command, pool) {
  const start = Date.now();

  switch (command) {
    case 'vpc status': {
      try {
        const processes = await pm2Service.list();
        const lines = processes.map((p) => `${p.name.padEnd(20)} ${p.status.padEnd(10)} CPU: ${p.cpu}%  MEM: ${p.memory_mb}MB  PID: ${p.pid}`);
        return { output: lines.join('\n') || 'No PM2 processes found', exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'vpc uptime': {
      const uptime = os.uptime();
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const mins = Math.floor((uptime % 3600) / 60);
      return { output: `System uptime: ${days}d ${hours}h ${mins}m`, exitCode: 0, duration_ms: Date.now() - start };
    }

    case 'vpc disk':
      return runCommand('df', ['-h']);

    case 'vpc memory':
      return runCommand('free', ['-h']);

    case 'vpc logs erp':
      return runCommand('tail', ['-n', '50', process.env.LOG_PATH_ERP || '/var/log/erp/app.log']);

    case 'vpc logs nginx':
      return runCommand('tail', ['-n', '50', process.env.LOG_PATH_NGINX_ACCESS || '/var/log/nginx/access.log']);

    case 'vpc restart erp': {
      try {
        const result = await pm2Service.restart('erp');
        return { output: result.message, exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'vpc restart nginx':
      return runCommand('systemctl', ['restart', 'nginx']);

    case 'vpc db status': {
      try {
        const { rows } = await pool.query('SELECT version(), current_database(), pg_size_pretty(pg_database_size(current_database())) as db_size');
        const info = rows[0];
        return {
          output: `Database: ${info.current_database}\nSize: ${info.db_size}\nVersion: ${info.version}`,
          exitCode: 0,
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'vpc db size': {
      try {
        const { rows } = await pool.query(
          `SELECT schemaname || '.' || tablename as table_name, pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
           FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC LIMIT 20`
        );
        const output = rows.map((r) => `${r.table_name.padEnd(40)} ${r.size}`).join('\n');
        return { output: output || 'No tables found', exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'vpc backup now': {
      try {
        const backupService = require('./backupService');
        const result = await backupService.runBackup(pool, { backupType: 'full' });
        return { output: `Backup ${result.status}: ${result.filename}`, exitCode: result.status === 'completed' ? 0 : 1, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'vpc network ports':
      return runCommand('ss', ['-tlnp']);

    default:
      return { output: `Unknown command: ${command}`, exitCode: 127, duration_ms: Date.now() - start };
  }
}

function runCommand(cmd, args) {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({
        output: err ? `Error: ${err.message}` : stdout || stderr || '(no output)',
        exitCode: err ? 1 : 0,
        duration_ms: Date.now() - start,
      });
    });
  });
}

module.exports = { execute };
