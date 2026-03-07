const os = require('os');
const { execFile } = require('child_process');
const pm2Service = require('./pm2Service');
const banadbService = require('./banadbService');
const syncService = require('./syncService');

// Map vpc commands to actual system operations
async function execute(command, pool) {
  const start = Date.now();

  // ── Dynamic BanaDB commands ──────────────────────────────
  if (command.startsWith('vpc bana ')) {
    return handleBanaCommand(command, pool, start);
  }

  // ── Dynamic DB query command ─────────────────────────────
  if (command.startsWith('vpc db query ')) {
    return handleDbQuery(command, pool, start);
  }

  // ── Static commands ──────────────────────────────────────
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

// ── BanaDB commands ──────────────────────────────────────────
async function handleBanaCommand(command, pool, start) {
  const args = command.replace('vpc bana ', '').trim();

  // vpc bana list
  if (args === 'list') {
    try {
      const projects = await banadbService.getProjects(pool);
      if (projects.length === 0) return { output: 'No BanaDB projects found', exitCode: 0, duration_ms: Date.now() - start };

      const header = 'SLUG'.padEnd(25) + 'STATUS'.padEnd(12) + 'DB_NAME'.padEnd(30) + 'DB_USER';
      const lines = projects.map((p) =>
        `${(p.slug || '').padEnd(25)}${(p.status || '').padEnd(12)}${(p.db_name || '').padEnd(30)}${p.db_user || ''}`
      );
      return { output: `${header}\n${'─'.repeat(80)}\n${lines.join('\n')}`, exitCode: 0, duration_ms: Date.now() - start };
    } catch (err) {
      return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
    }
  }

  // Parse: vpc bana <slug> <subcommand> [args...]
  const parts = args.split(/\s+/);
  const slug = parts[0];
  const subcommand = parts[1];

  if (!slug || !subcommand) {
    return {
      output: 'Usage:\n  vpc bana list\n  vpc bana <slug> tables\n  vpc bana <slug> size\n  vpc bana <slug> sql <query>\n  vpc bana <slug> fix-ownership\n  vpc bana <slug> info',
      exitCode: 1,
      duration_ms: Date.now() - start,
    };
  }

  // Resolve project
  let project;
  try {
    const projects = await banadbService.getProjects(pool);
    project = projects.find((p) => p.slug === slug);
    if (!project) {
      return { output: `Project not found: ${slug}`, exitCode: 1, duration_ms: Date.now() - start };
    }
  } catch (err) {
    return { output: `Error resolving project: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
  }

  const projectPool = banadbService.getProjectPool(project);

  switch (subcommand) {
    case 'info': {
      try {
        const { rows } = await projectPool.query('SELECT current_database(), current_user, pg_size_pretty(pg_database_size(current_database())) as db_size');
        const info = rows[0];
        return {
          output: `Project: ${project.name}\nSlug: ${project.slug}\nDatabase: ${info.current_database}\nUser: ${info.current_user}\nSize: ${info.db_size}\nStatus: ${project.status}\nMax connections: ${project.max_connections}`,
          exitCode: 0,
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'tables': {
      try {
        const { rows } = await projectPool.query(
          `SELECT t.tablename,
                  pg_size_pretty(pg_total_relation_size('public.' || t.tablename)) as size,
                  t.tableowner,
                  (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.tablename) as columns
           FROM pg_tables t
           WHERE t.schemaname = 'public'
           ORDER BY pg_total_relation_size('public.' || t.tablename) DESC`
        );
        if (rows.length === 0) return { output: 'No tables found', exitCode: 0, duration_ms: Date.now() - start };

        const header = 'TABLE'.padEnd(30) + 'SIZE'.padEnd(12) + 'COLS'.padEnd(8) + 'OWNER';
        const lines = rows.map((r) =>
          `${r.tablename.padEnd(30)}${r.size.padEnd(12)}${String(r.columns).padEnd(8)}${r.tableowner}`
        );
        return { output: `${header}\n${'─'.repeat(70)}\n${lines.join('\n')}`, exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'size': {
      try {
        const { rows } = await projectPool.query(
          `SELECT schemaname || '.' || tablename as table_name,
                  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
           FROM pg_tables WHERE schemaname = 'public'
           ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC LIMIT 20`
        );
        const output = rows.map((r) => `${r.table_name.padEnd(40)} ${r.size}`).join('\n');
        return { output: output || 'No tables found', exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'sql': {
      const sql = parts.slice(2).join(' ').trim();
      if (!sql) {
        return { output: 'Usage: vpc bana <slug> sql <query>', exitCode: 1, duration_ms: Date.now() - start };
      }
      try {
        const queryStart = Date.now();
        const result = await projectPool.query(sql);
        const queryDuration = Date.now() - queryStart;

        if (result.rows && result.rows.length > 0) {
          const output = formatTable(result.rows);
          return { output: `${output}\n\n${result.rowCount} row(s) returned (${queryDuration}ms)`, exitCode: 0, duration_ms: Date.now() - start };
        }
        return { output: `${result.command || 'OK'} — ${result.rowCount || 0} row(s) affected (${queryDuration}ms)`, exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `SQL Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    case 'fix-ownership': {
      try {
        await syncService.fixOwnership(project);
        return { output: `Ownership fixed for project "${project.slug}" — all objects reassigned to ${project.db_user}`, exitCode: 0, duration_ms: Date.now() - start };
      } catch (err) {
        return { output: `Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
      }
    }

    default:
      return {
        output: `Unknown subcommand: ${subcommand}\nAvailable: info, tables, size, sql, fix-ownership`,
        exitCode: 1,
        duration_ms: Date.now() - start,
      };
  }
}

// ── VPC DB query (main database) ─────────────────────────────
async function handleDbQuery(command, pool, start) {
  const sql = command.replace('vpc db query ', '').trim();
  if (!sql) {
    return { output: 'Usage: vpc db query <sql>', exitCode: 1, duration_ms: Date.now() - start };
  }

  try {
    const queryStart = Date.now();
    const result = await pool.query(sql);
    const queryDuration = Date.now() - queryStart;

    if (result.rows && result.rows.length > 0) {
      const output = formatTable(result.rows);
      return { output: `${output}\n\n${result.rowCount} row(s) returned (${queryDuration}ms)`, exitCode: 0, duration_ms: Date.now() - start };
    }
    return { output: `${result.command || 'OK'} — ${result.rowCount || 0} row(s) affected (${queryDuration}ms)`, exitCode: 0, duration_ms: Date.now() - start };
  } catch (err) {
    return { output: `SQL Error: ${err.message}`, exitCode: 1, duration_ms: Date.now() - start };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function formatTable(rows) {
  if (!rows || rows.length === 0) return '(empty)';

  const columns = Object.keys(rows[0]);
  const widths = columns.map((col) => {
    const maxData = rows.reduce((max, row) => {
      const val = String(row[col] ?? '');
      return Math.max(max, val.length);
    }, 0);
    return Math.min(Math.max(col.length, maxData), 50); // cap at 50 chars
  });

  const header = columns.map((col, i) => col.padEnd(widths[i])).join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('──');
  const body = rows.slice(0, 100).map((row) =>
    columns.map((col, i) => {
      const val = String(row[col] ?? '');
      return (val.length > 50 ? val.slice(0, 47) + '...' : val).padEnd(widths[i]);
    }).join('  ')
  );

  let output = `${header}\n${separator}\n${body.join('\n')}`;
  if (rows.length > 100) {
    output += `\n... and ${rows.length - 100} more rows`;
  }
  return output;
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
