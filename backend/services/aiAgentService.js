const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const aiProvider = require('./aiProviderService');

// ── Mode + Scope ────────────────────────────────────────────────────────
// Read-only tools are safe to run in 'read' mode. Anything else is blocked.
const READ_ONLY_TOOLS = new Set([
  'health_check', 'check_service', 'list_ports',
  'search_logs', 'analyze_logs', 'db_health',
  'list_dir', 'read_file', 'list_projects', 'list_todos',
  'diagnose',
  // run_sql + run_terminal handled separately (SELECT-only / blocked)
  'generate_document',
]);

const EXPORTS_DIR = path.join(__dirname, '..', 'exports');

function isSelectOnlySQL(sql) {
  if (!sql) return false;
  const stripped = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  // Must start with SELECT or WITH (CTE) and contain no semicolons followed by mutating verbs.
  if (!/^(select|with|show|explain)\b/i.test(stripped)) return false;
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i.test(stripped)) return false;
  return true;
}

async function getChatSettings(pool, userId) {
  if (!userId) return { mode: 'read_write', scope_enabled: false };
  try {
    const { rows } = await pool.query('SELECT * FROM ai_agent_chat_settings WHERE user_id = $1', [userId]);
    if (rows[0]) return rows[0];
  } catch {}
  return { mode: 'read_write', scope_enabled: false, allowed_hosting_ids: null, allowed_db_ids: null, allowed_repo_ids: null };
}

// ── Prompt Builder ───────────────────────────────────────────────────────

async function buildPrompt(userMessage, userId, pool, { channel = 'web', settings = null } = {}) {
  const sections = [];
  const now = new Date();
  const dateStr = now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const cs = settings || await getChatSettings(pool, userId);
  const modeLabel = cs.mode === 'read'
    ? 'READ-ONLY (you may inspect anything but cannot deploy, write files, run scripts, run mutating SQL, or send messages — refuse such requests politely)'
    : 'READ & WRITE (you may act, but write_file, edit_file, and run_script still require user approval)';
  sections.push(`[CONTEXT]\nDate/Time: ${dateStr}\nChannel: ${channel === 'telegram' ? 'Telegram (user is on mobile/remote — keep responses shorter)' : 'Web Dashboard (user is at the PC)'}\nMode: ${modeLabel}`);

  // 1. Personality
  try {
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'ai_agent_personality'");
    const personality = rows[0]?.value || getDefaultPersonality();
    sections.push(`[PERSONALITY]\n${personality}`);
  } catch {
    sections.push(`[PERSONALITY]\n${getDefaultPersonality()}`);
  }

  // 2. Current user
  let user = null;
  if (userId) {
    try {
      const { rows } = await pool.query('SELECT * FROM ai_agent_users WHERE id = $1', [userId]);
      user = rows[0];
    } catch {}
  }
  if (!user) {
    try {
      const { rows } = await pool.query('SELECT * FROM ai_agent_users WHERE is_default = true LIMIT 1');
      user = rows[0];
    } catch {}
  }
  if (user) {
    sections.push(`[CURRENT USER]\nName: ${user.name}\nDisplay Name: ${user.display_name || user.name}${user.greeting ? `\nGreeting: ${user.greeting}` : ''}`);
  }

  // 3. Shared memories (all users — Bot has single memory for the whole team)
  try {
    const { rows } = await pool.query(
      `SELECT m.fact, m.category, m.attributed_to, m.source, u.name as user_name, m.created_at
       FROM ai_agent_memory m LEFT JOIN ai_agent_users u ON m.user_id = u.id
       ORDER BY m.created_at DESC LIMIT 60`
    );
    if (rows.length > 0) {
      const mems = rows.map(r => {
        const who = r.attributed_to || r.user_name || 'system';
        const date = new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        return `- [${r.category}] (from ${who}, ${date}) ${r.fact}`;
      }).join('\n');
      sections.push(`[TEAM MEMORIES]\n${mems}`);
    }
  } catch {}

  // 4. Recent conversation
  if (user) {
    try {
      const { rows } = await pool.query(
        'SELECT role, content FROM ai_agent_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [user.id]
      );
      if (rows.length > 0) {
        const history = rows.reverse().map(r =>
          `${r.role === 'user' ? user.name : 'Bot'}: ${r.content.slice(0, 1000)}`
        ).join('\n');
        sections.push(`[RECENT CONVERSATION]\n${history}`);
      }
    } catch {}
  }

  // 5. System state — scoped to user's allocated resources when scope_enabled
  try {
    const state = [];
    const scope = cs.scope_enabled ? cs : null;
    const hostingFilter = scope?.allowed_hosting_ids;
    const dbFilter = scope?.allowed_db_ids;

    const hostingQuery = hostingFilter && hostingFilter.length > 0
      ? { sql: "SELECT id, name, slug, status, project_type, node_port FROM web_hosting_projects WHERE id = ANY($1) ORDER BY name", args: [hostingFilter] }
      : hostingFilter && hostingFilter.length === 0
        ? null
        : { sql: "SELECT id, name, slug, status, project_type, node_port FROM web_hosting_projects ORDER BY name", args: [] };
    const { rows: hosting } = hostingQuery ? await pool.query(hostingQuery.sql, hostingQuery.args) : { rows: [] };
    if (hosting.length) {
      const scopeNote = scope ? ' (scoped — only these are in your scope)' : '';
      state.push(`Web Hosting Projects${scopeNote}:\n` + hosting.map(h =>
        `  - ${h.name} (/${h.slug}/) [${h.status}] type=${h.project_type}${h.node_port ? ` port=${h.node_port}` : ''}`
      ).join('\n'));
    } else if (scope) {
      state.push('Web Hosting Projects: (none in scope)');
    }

    const dbQuery = dbFilter && dbFilter.length > 0
      ? { sql: "SELECT id, name, slug, status, db_name FROM db_projects WHERE status != 'deleted' AND id = ANY($1) ORDER BY name", args: [dbFilter] }
      : dbFilter && dbFilter.length === 0
        ? null
        : { sql: "SELECT id, name, slug, status, db_name FROM db_projects WHERE status != 'deleted' ORDER BY name", args: [] };
    const { rows: dbProjects } = dbQuery ? await pool.query(dbQuery.sql, dbQuery.args) : { rows: [] };
    if (dbProjects.length) {
      const dbInfo = [];
      for (const b of dbProjects) {
        let tables = '';
        try {
          const dbService = require('./dbService');
          const dbPool = dbService.getProjectAdminPool(b);
          const { rows: tRows } = await dbPool.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
          );
          if (tRows.length) tables = ` tables: ${tRows.map(t => t.table_name).join(', ')}`;
        } catch {}
        dbInfo.push(`  - ${b.name} (slug: "${b.slug}") [${b.status}]${tables}`);
      }
      const scopeNote = scope ? ' (scoped)' : '';
      state.push(`DB Projects${scopeNote} (use run_sql with projectSlug to query):\n` + dbInfo.join('\n'));
    } else if (scope) {
      state.push('DB Projects: (none in scope)');
    }

    if (state.length) sections.push(`[SYSTEM STATE]\n${state.join('\n\n')}`);
  } catch {}

  // 5b. Active TODOs
  try {
    const { rows: todos } = await pool.query(
      "SELECT id, title, status, priority, assigned_by, assigned_to, due_date, created_at FROM ai_agent_todos WHERE status != 'done' ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC LIMIT 20"
    );
    if (todos.length) {
      const todoList = todos.map(t => {
        const due = t.due_date ? ` due:${new Date(t.due_date).toLocaleDateString('en-IN')}` : '';
        return `  - [${t.status}] ${t.title} (${t.priority}${due}, by:${t.assigned_by || '?'}, for:${t.assigned_to || 'Bot'}) #${t.id}`;
      }).join('\n');
      sections.push(`[ACTIVE TASKS/TODOS]\n${todoList}`);
    }
  } catch {}

  // 6. Tool instructions
  sections.push(TOOL_INSTRUCTIONS);

  // 7. User message
  sections.push(`[USER MESSAGE FROM ${user?.name || 'Unknown'}]\n${userMessage}`);

  return sections.join('\n\n');
}

const TOOL_INSTRUCTIONS = `[AVAILABLE TOOLS]
You can perform actions by including JSON blocks. Use MULTIPLE tools in ONE response to complete tasks efficiently.
\`\`\`tool
{"tool": "tool_name", "params": {...}}
\`\`\`

═══ INFRASTRUCTURE ═══
- run_terminal: {"command": "vpc status"} — Run any VPC terminal command
- pm2_action: {"action": "restart|stop|start|logs", "name": "..."} — Manage PM2 processes
- health_check: {} — Get full server health (CPU, memory, disk, processes, uptime)
- check_service: {"service": "nginx|postgresql|pm2"} — Check if a specific service is running
- list_ports: {} — Show all open ports and which process uses them
- search_logs: {"query": "error", "lines": 100, "logFile": "erp|nginx|pm2"} — Search through log files
- analyze_logs: {"logFile": "erp|nginx", "lines": 200} — AI analysis of recent logs for errors/patterns

═══ DEPLOYMENT ═══
- deploy_site: {"slug": "..."} — Redeploy an existing web hosting project
- create_site: {"name": "...", "slug": "...", "gitUrl": "...", "gitBranch": "main"} — Create new hosting project from GitHub
- git_operation: {"slug": "...", "command": "git pull origin main"} — Git command in a project directory
- list_projects: {} — List all hosting + DB projects

═══ DATABASE ═══
- create_database: {"name": "...", "slug": "..."} — Create a new DB project
- run_sql: {"sql": "SELECT ...", "projectSlug": "..."} — Run SQL. Omit projectSlug for VPC main DB.
- db_health: {"projectSlug": "..."} — Check DB health (connections, size, slow queries, locks)

═══ COMMUNICATION ═══
- broadcast: {"message": "..."} — Send urgent message to ALL team members on Telegram
- message_user: {"userName": "...", "message": "..."} — Send Telegram to specific person

═══ MEMORY & TASKS ═══
- store_memory: {"fact": "...", "category": "general|preference|project|technical", "attributed_to": "..."} — Remember something permanently
- add_todo: {"title": "...", "priority": "normal|high|urgent", "assignedBy": "...", "assignedTo": "Bot", "description": "...", "dueDate": "2026-03-30"} — Create task
- update_todo: {"id": 1, "status": "in_progress|done|blocked", "notes": "..."} — Update task
- list_todos: {} — Show active tasks

═══ FILE OPERATIONS ═══
- read_file: {"path": "..."} — Read a file
- list_dir: {"path": "..."} — List directory contents with sizes
- write_file: {"path": "...", "content": "..."} — Write/create a file (NEEDS APPROVAL)
- edit_file: {"path": "...", "find": "...", "replace": "..."} — Find and replace (NEEDS APPROVAL)
- run_script: {"command": "...", "cwd": "..."} — Run shell command (NEEDS APPROVAL, dangerous patterns blocked)

═══ DIAGNOSTICS ═══
- diagnose: {"issue": "site is slow|502 error|high cpu|db connection issues|..."} — Auto-diagnose a problem. Runs multiple checks and gives root cause + fix.

═══ DOCUMENT GENERATION ═══
- generate_document: {"format": "pdf|xlsx|csv|md|html", "title": "...", "filename": "report",
    "content": "markdown text" | "rows": [[...], [...]] | "headers": [...]}
  Creates a downloadable document the user can grab from the chat. Use rows+headers for xlsx/csv;
  use content (markdown) for pdf/md/html. Always set a clear title and a slug-style filename.

APPROVAL RULES for write_file, edit_file, run_script:
- ALWAYS ask user first. Tell them what you plan to do, ask "Should I proceed?"
- Only after yes/confirm, system adds _approved: true automatically.

AUTONOMOUS BEHAVIOR:
- When given a task, DO it. Don't explain how you'll do it — just do it.
- Use MULTIPLE tools in a single response. Don't wait between steps.
- If something fails, diagnose it yourself: check logs, check services, check disk, check ports.
- If a service is down, restart it. If disk is full, identify the largest files. If a process crashed, check logs then restart.
- Create todos for multi-step tasks. Update them as you progress.
- Store EVERY important decision, pattern, and fix in memory so you learn.
- Alert the team on Telegram for: failures, completions, anything urgent.
- When on Telegram, keep responses SHORT.
- STOP = halt everything immediately.

MULTI-STEP EXECUTION:
When a task requires multiple steps, execute them ALL in one response:
Example: "Deploy my site" →
1. git_operation to pull latest code
2. run_script to install deps (with approval)
3. deploy_site to deploy
4. health_check to verify
5. message_user to notify
All in ONE response. Don't ask "should I pull first?" — just do it.

DIAGNOSTIC THINKING:
When something is wrong, think like a sysadmin:
1. Check the service status
2. Check recent logs for errors
3. Check disk/memory/CPU
4. Check database connections
5. Identify root cause
6. Fix it or recommend a fix
7. Alert the team

Respond naturally. Be direct. Act fast.`;

// ── Tool Execution ───────────────────────────────────────────────────────

async function executeTool(toolName, params, userId, pool, ctx = {}) {
  const settings = ctx.settings || await getChatSettings(pool, userId);
  const isRead = settings.mode === 'read';

  // Mode gating
  if (isRead) {
    if (toolName === 'run_sql' && !isSelectOnlySQL(params?.sql)) {
      return { error: 'Read-only mode: only SELECT/WITH/SHOW/EXPLAIN queries allowed.' };
    }
    if (toolName === 'run_terminal') {
      const cmd = (params?.command || '').toLowerCase();
      const safeRead = /^(vpc\s+(status|logs|info|list|show|ps)|status|uptime|free|df|ls|cat|tail|head|ps|top)\b/.test(cmd);
      if (!safeRead) return { error: 'Read-only mode: terminal command blocked. Switch to Read & Write mode.' };
    }
    if (!READ_ONLY_TOOLS.has(toolName) && toolName !== 'run_sql' && toolName !== 'run_terminal') {
      return { error: `Read-only mode: tool "${toolName}" is blocked. Switch to Read & Write mode to run it.` };
    }
  }

  // Scope gating: when scope is enabled, deployments / SQL / git limited to allowed slugs
  if (settings.scope_enabled) {
    if ((toolName === 'deploy_site' || toolName === 'git_operation') && params?.slug) {
      const { rows } = await pool.query('SELECT id FROM web_hosting_projects WHERE slug = $1', [params.slug]);
      const id = rows[0]?.id;
      const allowed = settings.allowed_hosting_ids || [];
      if (!id || !allowed.includes(id)) return { error: `Scope: hosting project "${params.slug}" not in your allocated scope.` };
    }
    if ((toolName === 'run_sql' || toolName === 'db_health') && params?.projectSlug) {
      const { rows } = await pool.query('SELECT id FROM db_projects WHERE slug = $1', [params.projectSlug]);
      const id = rows[0]?.id;
      const allowed = settings.allowed_db_ids || [];
      if (!id || !allowed.includes(id)) return { error: `Scope: database "${params.projectSlug}" not in your allocated scope.` };
    }
  }

  return executeToolCore(toolName, params, userId, pool, ctx);
}

async function executeToolCore(toolName, params, userId, pool, ctx = {}) {
  switch (toolName) {
    case 'deploy_site': {
      const webHostingService = require('./webHostingService');
      const project = await webHostingService.getProjectBySlug(pool, params.slug);
      if (!project) return { error: `Project "${params.slug}" not found` };
      const result = await webHostingService.deploy(pool, project);
      return { success: true, log: result.log?.slice(-500) || 'Deployed' };
    }

    case 'create_site': {
      const webHostingService = require('./webHostingService');
      const project = await webHostingService.createProject(pool, {
        name: params.name,
        slug: params.slug,
        projectType: params.projectType || 'static',
        gitUrl: params.gitUrl,
        gitBranch: params.gitBranch || 'main',
        createdBy: null,
      });
      return { success: true, project: { id: project.id, slug: project.slug, name: project.name } };
    }

    case 'create_database': {
      const dbService = require('./dbService');
      const slug = params.slug || dbService.generateSlug(params.name);
      const project = await dbService.createProject(pool, {
        name: params.name,
        slug,
        storageLimitMb: params.storageLimitMb || 500,
        maxConnections: params.maxConnections || 10,
        createdBy: null,
      });
      // Auto-create API keys
      const keys = await dbService.ensureDefaultKeys(pool, project.id);
      return {
        success: true,
        project: { id: project.id, slug: project.slug, name: project.name, db_name: project.db_name },
        api_keys: keys.map(k => ({ name: k.name, role: k.role, key: k.api_key })),
      };
    }

    case 'run_terminal': {
      const terminalService = require('./terminalService');
      const result = await terminalService.execute(params.command, pool);
      return result;
    }

    case 'health_check': {
      const os = require('os');
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const memUsage = ((1 - freeMem / totalMem) * 100).toFixed(1);
      const uptime = Math.floor(os.uptime() / 3600);

      // Disk usage
      let disk = 'unknown';
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          execFile('df', ['-h', '/'], { timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve({ stdout }));
        });
        const lines = stdout.trim().split('\n');
        if (lines[1]) disk = lines[1].replace(/\s+/g, ' ');
      } catch {}

      // PM2 processes
      let pm2List = [];
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          execFile('pm2', ['jlist'], { timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve({ stdout }));
        });
        pm2List = JSON.parse(stdout).map(p => ({
          name: p.name, status: p.pm2_env?.status, cpu: p.monit?.cpu, memory: Math.round((p.monit?.memory || 0) / 1024 / 1024) + 'MB',
          restarts: p.pm2_env?.restart_time, uptime: p.pm2_env?.pm_uptime ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 3600000) + 'h' : '?',
        }));
      } catch {}

      // Load average
      const loadAvg = os.loadavg().map(l => l.toFixed(2));

      return {
        cpu: { cores: cpus.length, model: cpus[0]?.model, loadAvg },
        memory: { total: (totalMem / 1e9).toFixed(1) + 'GB', free: (freeMem / 1e9).toFixed(1) + 'GB', usage: memUsage + '%' },
        disk,
        uptime: uptime + ' hours',
        processes: pm2List,
        hostname: os.hostname(),
        platform: os.platform(),
      };
    }

    case 'check_service': {
      const service = params.service;
      return new Promise(resolve => {
        execFile('sh', ['-c', `systemctl is-active ${service} 2>/dev/null || (pgrep -x ${service} > /dev/null && echo "active" || echo "inactive")`],
          { timeout: 5000 }, (err, stdout) => {
            const status = (stdout || '').trim();
            resolve({ service, status, running: status === 'active' });
          });
      });
    }

    case 'list_ports': {
      return new Promise(resolve => {
        execFile('sh', ['-c', 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null'], { timeout: 5000 }, (err, stdout) => {
          resolve({ output: (stdout || 'Could not list ports').slice(0, 3000) });
        });
      });
    }

    case 'search_logs': {
      const logPaths = {
        erp: process.env.LOG_PATH_ERP || '/var/log/erp/app.log',
        nginx: process.env.LOG_PATH_NGINX_ACCESS || '/var/log/nginx/access.log',
        'nginx-error': process.env.LOG_PATH_NGINX_ERROR || '/var/log/nginx/error.log',
        pm2: '/root/.pm2/logs/vpc-out.log',
        'pm2-error': '/root/.pm2/logs/vpc-error.log',
      };
      const logFile = logPaths[params.logFile] || params.logFile;
      const lines = params.lines || 100;
      const query = params.query || '';
      return new Promise(resolve => {
        const cmd = query
          ? `tail -${lines} "${logFile}" 2>/dev/null | grep -i "${query.replace(/"/g, '\\"')}" | tail -50`
          : `tail -${lines} "${logFile}" 2>/dev/null`;
        execFile('sh', ['-c', cmd], { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve({ error: `No results or file not found: ${logFile}` });
          resolve({ log: stdout.slice(0, 5000), file: logFile, matchCount: stdout.split('\n').length - 1 });
        });
      });
    }

    case 'analyze_logs': {
      const logPaths = {
        erp: process.env.LOG_PATH_ERP || '/var/log/erp/app.log',
        nginx: process.env.LOG_PATH_NGINX_ERROR || '/var/log/nginx/error.log',
        pm2: '/root/.pm2/logs/vpc-error.log',
      };
      const logFile = logPaths[params.logFile] || params.logFile;
      const lines = params.lines || 200;
      return new Promise(resolve => {
        execFile('sh', ['-c', `tail -${lines} "${logFile}" 2>/dev/null`], { timeout: 10000 }, (err, stdout) => {
          if (err || !stdout.trim()) return resolve({ error: `Could not read: ${logFile}` });
          resolve({ log: stdout.slice(0, 8000), file: logFile, instruction: 'Analyze these logs. Identify errors, patterns, and suggest fixes.' });
        });
      });
    }

    case 'db_health': {
      let targetPool = pool;
      if (params.projectSlug) {
        const dbService = require('./dbService');
        const { rows } = await pool.query("SELECT * FROM db_projects WHERE slug = $1 AND status = 'active'", [params.projectSlug]);
        if (!rows[0]) return { error: `DB project "${params.projectSlug}" not found` };
        targetPool = dbService.getProjectAdminPool(rows[0]);
      }
      const [sizeRes, connRes, lockRes] = await Promise.all([
        targetPool.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size"),
        targetPool.query("SELECT count(*) as active FROM pg_stat_activity WHERE state = 'active'"),
        targetPool.query("SELECT count(*) as locks FROM pg_locks WHERE NOT granted"),
      ]);
      let slowQueries = [];
      try {
        const sq = await targetPool.query("SELECT pid, now() - pg_stat_activity.query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 seconds' ORDER BY duration DESC LIMIT 5");
        slowQueries = sq.rows;
      } catch {}
      return {
        size: sizeRes.rows[0]?.size,
        activeConnections: parseInt(connRes.rows[0]?.active || 0),
        blockedLocks: parseInt(lockRes.rows[0]?.locks || 0),
        slowQueries: slowQueries.map(q => ({ pid: q.pid, duration: String(q.duration), query: (q.query || '').slice(0, 200) })),
      };
    }

    case 'list_dir': {
      const safePath = path.resolve(params.path || '/root/projects');
      if (!safePath.startsWith('/root/web-hosting') && !safePath.startsWith('/root/projects') && safePath !== '/root') {
        return { error: 'Access denied' };
      }
      return new Promise(resolve => {
        execFile('sh', ['-c', `ls -lahS "${safePath}" 2>/dev/null | head -50`], { timeout: 5000 }, (err, stdout) => {
          if (err) return resolve({ error: 'Could not list directory' });
          resolve({ path: safePath, listing: stdout.slice(0, 3000) });
        });
      });
    }

    case 'diagnose': {
      const issue = (params.issue || '').toLowerCase();
      const checks = [];

      // Always check basics
      checks.push({ tool: 'health_check', params: {} });

      if (issue.includes('slow') || issue.includes('cpu') || issue.includes('performance')) {
        checks.push({ tool: 'search_logs', params: { logFile: 'pm2-error', query: 'error', lines: 50 } });
        checks.push({ tool: 'db_health', params: {} });
      }
      if (issue.includes('502') || issue.includes('503') || issue.includes('nginx') || issue.includes('down')) {
        checks.push({ tool: 'check_service', params: { service: 'nginx' } });
        checks.push({ tool: 'check_service', params: { service: 'postgresql' } });
        checks.push({ tool: 'search_logs', params: { logFile: 'nginx-error', query: 'error', lines: 30 } });
      }
      if (issue.includes('db') || issue.includes('database') || issue.includes('connection') || issue.includes('postgres')) {
        checks.push({ tool: 'check_service', params: { service: 'postgresql' } });
        checks.push({ tool: 'db_health', params: {} });
      }
      if (issue.includes('disk') || issue.includes('space') || issue.includes('storage')) {
        checks.push({ tool: 'list_dir', params: { path: '/root' } });
      }
      if (issue.includes('memory') || issue.includes('ram') || issue.includes('oom')) {
        checks.push({ tool: 'search_logs', params: { logFile: 'pm2-error', query: 'heap\\|memory\\|ENOMEM', lines: 30 } });
      }

      // Execute all diagnostic checks
      const results = {};
      for (const check of checks) {
        try {
          results[check.tool + (check.params.service || check.params.logFile || '')] = await executeToolCore(check.tool, check.params, userId, pool, ctx);
        } catch (err) {
          results[check.tool] = { error: err.message };
        }
      }
      return { issue: params.issue, diagnostics: results, instruction: 'Analyze ALL diagnostic results above. Identify the root cause. Provide a clear fix. If you can fix it with available tools, do it.' };
    }

    case 'run_sql': {
      // Can query main VPC DB or any DB project by slug
      let targetPool = pool;
      if (params.projectSlug) {
        const dbService = require('./dbService');
        const { rows: projRows } = await pool.query(
          "SELECT * FROM db_projects WHERE slug = $1 AND status = 'active'", [params.projectSlug]
        );
        if (!projRows[0]) return { error: `DB project "${params.projectSlug}" not found` };
        targetPool = dbService.getProjectAdminPool(projRows[0]);
      }
      const result = await targetPool.query(params.sql);
      return { rows: result.rows.slice(0, 200), rowCount: result.rowCount, command: result.command };
    }

    case 'git_operation': {
      const os = require('os');
      const projectDir = path.join(os.homedir(), 'web-hosting', params.slug);
      if (!fs.existsSync(projectDir)) return { error: `Project dir not found: ${params.slug}` };
      return new Promise((resolve) => {
        execFile('sh', ['-c', params.command], { cwd: projectDir, timeout: 30000 }, (err, stdout, stderr) => {
          if (err) return resolve({ error: err.message, stderr });
          resolve({ output: (stdout + stderr).slice(0, 2000) });
        });
      });
    }

    case 'pm2_action': {
      return new Promise((resolve) => {
        execFile('pm2', [params.action, params.name], { timeout: 15000 }, (err, stdout) => {
          if (err) return resolve({ error: err.message });
          resolve({ output: stdout.slice(0, 1000) });
        });
      });
    }

    case 'store_memory': {
      // Get user name for attribution
      let userName = 'system';
      if (userId) {
        try {
          const { rows } = await pool.query('SELECT name FROM ai_agent_users WHERE id = $1', [userId]);
          userName = rows[0]?.name || 'system';
        } catch {}
      }
      await pool.query(
        'INSERT INTO ai_agent_memory (user_id, category, fact, source, attributed_to) VALUES ($1, $2, $3, $4, $5)',
        [userId, params.category || 'general', params.fact, 'auto', params.attributed_to || userName]
      );
      return { stored: true, fact: params.fact };
    }

    case 'broadcast': {
      const jarvisTg = require('./jarvisTelegramService');
      await jarvisTg.broadcast(params.message);
      return { sent: true, message: params.message };
    }

    case 'message_user': {
      const jarvisTg2 = require('./jarvisTelegramService');
      await jarvisTg2.messageUser(params.userName, params.message);
      return { sent: true, to: params.userName };
    }

    case 'list_projects': {
      const hosting = await pool.query("SELECT name, slug, status, project_type FROM web_hosting_projects ORDER BY name");
      const dbProjects = await pool.query("SELECT name, slug, status FROM db_projects WHERE status != 'deleted' ORDER BY name");
      return { hosting: hosting.rows, databases: dbProjects.rows };
    }

    case 'read_file': {
      const safePath = path.resolve(params.path);
      if (!safePath.startsWith('/root/web-hosting/') && !safePath.startsWith('/root/projects/')) {
        return { error: 'Access denied: can only read files in project directories' };
      }
      if (!fs.existsSync(safePath)) return { error: 'File not found' };
      const content = fs.readFileSync(safePath, 'utf8');
      return { content: content.slice(0, 5000), truncated: content.length > 5000 };
    }

    case 'add_todo': {
      const { rows } = await pool.query(
        `INSERT INTO ai_agent_todos (title, description, priority, assigned_by, assigned_to, due_date)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [params.title, params.description || null, params.priority || 'normal',
         params.assignedBy || null, params.assignedTo || 'Bot',
         params.dueDate ? new Date(params.dueDate) : null]
      );
      return { created: true, todo: rows[0] };
    }

    case 'update_todo': {
      const sets = [];
      const vals = [];
      let i = 1;
      if (params.status) { sets.push(`status = $${i++}`); vals.push(params.status); }
      if (params.notes) { sets.push(`notes = $${i++}`); vals.push(params.notes); }
      if (params.status === 'done') { sets.push(`completed_at = NOW()`); }
      sets.push('updated_at = NOW()');
      vals.push(params.id);
      const { rows } = await pool.query(
        `UPDATE ai_agent_todos SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
      );
      return rows[0] ? { updated: true, todo: rows[0] } : { error: 'Todo not found' };
    }

    case 'list_todos': {
      const { rows } = await pool.query(
        "SELECT * FROM ai_agent_todos WHERE status != 'done' ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC"
      );
      return { todos: rows };
    }

    case 'write_file': {
      const safePath = path.resolve(params.path);
      if (!safePath.startsWith('/root/web-hosting/') && !safePath.startsWith('/root/projects/')) {
        return { error: 'Access denied: can only write to project directories' };
      }
      // Needs user approval — this is set by the chat handler when confirmed
      if (!params._approved) {
        return { needs_approval: true, action: 'write_file', path: safePath, preview: (params.content || '').slice(0, 500) };
      }
      const dir = path.dirname(safePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(safePath, params.content, 'utf8');
      return { written: true, path: safePath, bytes: Buffer.byteLength(params.content) };
    }

    case 'edit_file': {
      const safePath2 = path.resolve(params.path);
      if (!safePath2.startsWith('/root/web-hosting/') && !safePath2.startsWith('/root/projects/')) {
        return { error: 'Access denied: can only edit project directories' };
      }
      if (!fs.existsSync(safePath2)) return { error: 'File not found' };
      if (!params._approved) {
        return { needs_approval: true, action: 'edit_file', path: safePath2, find: (params.find || '').slice(0, 200), replace: (params.replace || '').slice(0, 200) };
      }
      let content = fs.readFileSync(safePath2, 'utf8');
      if (!content.includes(params.find)) return { error: 'Search string not found in file' };
      content = content.replace(params.find, params.replace);
      fs.writeFileSync(safePath2, content, 'utf8');
      return { edited: true, path: safePath2 };
    }

    case 'run_script': {
      // Safety: only allow scripts in project dirs, block dangerous patterns
      const BLOCKED = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'chmod -R 777 /', 'shutdown', 'reboot', 'kill -9 1',
        'DROP DATABASE', 'DROP SCHEMA', '> /dev/sd', 'wipefs', 'fdisk', 'passwd'];
      const cmd = params.command || '';
      for (const b of BLOCKED) {
        if (cmd.toLowerCase().includes(b.toLowerCase())) {
          return { error: `Blocked: command contains dangerous pattern "${b}"` };
        }
      }
      if (!params._approved) {
        return { needs_approval: true, action: 'run_script', command: cmd.slice(0, 500) };
      }
      const cwd = params.cwd ? path.resolve(params.cwd) : '/root/projects/VPC';
      if (!cwd.startsWith('/root/web-hosting/') && !cwd.startsWith('/root/projects/')) {
        return { error: 'Access denied: cwd must be in project directories' };
      }
      return new Promise((resolve) => {
        execFile('sh', ['-c', cmd], { cwd, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) return resolve({ error: err.message, stderr: (stderr || '').slice(0, 1000) });
          resolve({ output: (stdout + (stderr || '')).slice(0, 3000) });
        });
      });
    }

    case 'generate_document': {
      try {
        if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });
        const format = (params.format || 'md').toLowerCase();
        const baseName = (params.filename || 'document').toString().replace(/[^a-z0-9_-]+/gi, '-').toLowerCase().slice(0, 64) || 'document';
        const stamp = Date.now();
        const ext = ({ pdf: 'pdf', xlsx: 'xlsx', csv: 'csv', md: 'md', html: 'html' })[format] || 'txt';
        const filename = `${baseName}-${stamp}.${ext}`;
        const filepath = path.join(EXPORTS_DIR, filename);
        const title = params.title || baseName;

        if (format === 'csv') {
          const headers = params.headers || (params.rows?.[0] ? Object.keys(params.rows[0]) : []);
          const rows = params.rows || [];
          const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
          const lines = [headers.map(esc).join(',')];
          for (const r of rows) {
            const arr = Array.isArray(r) ? r : headers.map(h => r[h]);
            lines.push(arr.map(esc).join(','));
          }
          fs.writeFileSync(filepath, lines.join('\n'), 'utf8');
        } else if (format === 'xlsx') {
          const ExcelJS = require('exceljs');
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet(title.slice(0, 30));
          const headers = params.headers || (params.rows?.[0] ? Object.keys(params.rows[0]) : []);
          if (headers.length) {
            ws.addRow(headers);
            ws.getRow(1).font = { bold: true };
          }
          for (const r of (params.rows || [])) {
            ws.addRow(Array.isArray(r) ? r : headers.map(h => r[h]));
          }
          ws.columns.forEach(c => { c.width = Math.max(c.width || 10, 14); });
          await wb.xlsx.writeFile(filepath);
        } else if (format === 'md') {
          const body = `# ${title}\n\n${params.content || ''}\n`;
          fs.writeFileSync(filepath, body, 'utf8');
        } else if (format === 'html') {
          const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#222}
h1{border-bottom:1px solid #ddd;padding-bottom:.4rem}pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow:auto}
code{background:#f5f5f5;padding:.1rem .35rem;border-radius:3px}</style></head>
<body><h1>${escapeHtml(title)}</h1>${markdownToHtml(params.content || '')}</body></html>`;
          fs.writeFileSync(filepath, body, 'utf8');
        } else if (format === 'pdf') {
          const PDFDocument = require('pdfkit');
          await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50 });
            const stream = fs.createWriteStream(filepath);
            doc.pipe(stream);
            doc.fontSize(20).text(title, { underline: true });
            doc.moveDown();
            doc.fontSize(11);
            const lines = (params.content || '').split('\n');
            for (const line of lines) {
              if (line.startsWith('# ')) doc.fontSize(16).text(line.slice(2)).fontSize(11);
              else if (line.startsWith('## ')) doc.fontSize(14).text(line.slice(3)).fontSize(11);
              else doc.text(line);
            }
            // Optional table from rows+headers
            if (params.rows?.length) {
              doc.moveDown();
              const headers = params.headers || Object.keys(params.rows[0] || {});
              if (headers.length) doc.font('Helvetica-Bold').text(headers.join(' | ')).font('Helvetica');
              for (const r of params.rows) {
                const arr = Array.isArray(r) ? r : headers.map(h => r[h]);
                doc.text(arr.join(' | '));
              }
            }
            doc.end();
            stream.on('finish', resolve);
            stream.on('error', reject);
          });
        } else {
          return { error: `Unsupported format: ${format}` };
        }

        const stat = fs.statSync(filepath);
        try {
          await pool.query(
            `INSERT INTO ai_agent_documents (user_id, filename, format, byte_size, title)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId || null, filename, format, stat.size, title]
          );
        } catch {}

        return {
          success: true,
          document: {
            filename,
            format,
            title,
            byte_size: stat.size,
            download_url: `/api/admin/settings/ai-agent/exports/${filename}`,
          },
        };
      } catch (err) {
        return { error: `Document generation failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function markdownToHtml(md) {
  // Tiny, dependency-free MD -> HTML for our generated docs
  return escapeHtml(md)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<)/, '<p>') + '</p>';
}

// ── Parse tool calls from AI response ────────────────────────────────────

function parseToolCalls(text) {
  const tools = [];
  // Match ```tool { ... } ``` blocks
  const blockRegex = /```tool\s*\n?([\s\S]*?)```/g;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    try {
      tools.push(JSON.parse(match[1].trim()));
    } catch {}
  }
  // Also match inline {"tool": "..."} on its own line
  const lineRegex = /^(\{"tool"\s*:\s*"[^"]+?"[\s\S]*?\})\s*$/gm;
  while ((match = lineRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && !tools.some(t => t.tool === parsed.tool)) {
        tools.push(parsed);
      }
    } catch {}
  }
  // Parse memory store requests
  const memRegex = /\{"memory"\s*:\s*"([^"]+)"(?:,\s*"category"\s*:\s*"([^"]+)")?\}/g;
  while ((match = memRegex.exec(text)) !== null) {
    tools.push({ tool: 'store_memory', params: { fact: match[1], category: match[2] || 'general' } });
  }
  return tools;
}

function stripToolBlocks(text) {
  return text
    .replace(/```tool\s*\n?[\s\S]*?```/g, '')
    .replace(/^(\{"tool"\s*:\s*"[^"]+?"[\s\S]*?\})\s*$/gm, '')
    .replace(/\{"memory"\s*:\s*"[^"]+?"(?:,\s*"category"\s*:\s*"[^"]+?")?\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Main Chat Handler ────────────────────────────────────────────────────

async function chat(userMessage, userId, pool, { channel = 'web', provider, model } = {}) {
  const ok = await aiProvider.isAnyAvailable(pool);
  if (!ok) throw new Error('No AI provider available');

  const settings = await getChatSettings(pool, userId);
  const ctx = { settings };

  // Save user message
  await pool.query(
    'INSERT INTO ai_agent_conversations (user_id, role, content) VALUES ($1, $2, $3)',
    [userId || null, 'user', userMessage]
  );

  // Build prompt and call CLI
  const prompt = await buildPrompt(userMessage, userId, pool, { channel, settings });
  const chatResult = await aiProvider.chat(prompt, { pool, provider, model });
  let response = chatResult.text;

  // Check if this is a confirmation of a pending action
  const confirmWords = ['yes', 'y', 'go', 'proceed', 'do it', 'confirm', 'ok', 'sure', 'go ahead', 'approved'];
  const isConfirmation = confirmWords.some(w => userMessage.toLowerCase().trim() === w || userMessage.toLowerCase().trim().startsWith(w + ' '));

  // If confirming, check for pending approval in recent conversation
  if (isConfirmation) {
    try {
      const { rows: recent } = await pool.query(
        "SELECT tool_calls FROM ai_agent_conversations WHERE user_id = $1 AND role = 'assistant' AND tool_calls IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        [userId]
      );
      if (recent[0]?.tool_calls) {
        const pending = JSON.parse(recent[0].tool_calls);
        const needsApproval = pending.filter(t => t.result?.needs_approval);
        if (needsApproval.length > 0) {
          const approvedResults = [];
          for (const t of needsApproval) {
            try {
              const approvedParams = { ...t.params, _approved: true };
              const result = await executeTool(t.result.action || t.tool, approvedParams, userId, pool, ctx);
              approvedResults.push({ tool: t.result.action || t.tool, params: t.params, result });
            } catch (err) {
              approvedResults.push({ tool: t.result.action || t.tool, error: err.message });
            }
          }
          const resultSummary = approvedResults.map(t =>
            `Tool "${t.tool}": ${JSON.stringify(t.result || t.error).slice(0, 1500)}`
          ).join('\n');
          const summaryPrompt = await buildPrompt(
            `User confirmed the pending action. Results:\n${resultSummary}\n\nSummarize what was done. Be concise.`,
            userId, pool, { channel, settings }
          );
          let summaryResponse;
          try {
            const summaryResult = await aiProvider.chat(summaryPrompt, { pool, provider, model, timeout: 60000 });
            summaryResponse = summaryResult.text;
          } catch { summaryResponse = 'Done.'; }
          const clean = stripToolBlocks(summaryResponse) || summaryResponse;
          await pool.query(
            'INSERT INTO ai_agent_conversations (user_id, role, content, tool_calls) VALUES ($1, $2, $3, $4)',
            [userId || null, 'assistant', clean, JSON.stringify(approvedResults)]
          );
          return { response: clean, toolResults: approvedResults };
        }
      }
    } catch {}
  }

  // Parse and execute tool calls
  const toolCalls = parseToolCalls(response);
  const toolResults = [];
  let hasPendingApproval = false;

  for (const tc of toolCalls) {
    try {
      const result = await executeTool(tc.tool, tc.params || {}, userId, pool, ctx);
      if (result?.needs_approval) {
        hasPendingApproval = true;
      }
      toolResults.push({ tool: tc.tool, params: tc.params, result });
    } catch (err) {
      toolResults.push({ tool: tc.tool, params: tc.params, error: err.message });
    }
  }

  // If tools were executed (and none are pending approval), call CLI again with results
  if (toolResults.length > 0 && !hasPendingApproval && toolResults.some(t => t.tool !== 'store_memory')) {
    const resultSummary = toolResults
      .filter(t => t.tool !== 'store_memory')
      .map(t => `Tool "${t.tool}": ${JSON.stringify(t.result || t.error).slice(0, 1500)}`)
      .join('\n');

    const followUp = `${prompt}\n\n[ASSISTANT PREVIOUS RESPONSE]\n${response}\n\n[TOOL RESULTS]\n${resultSummary}\n\nNow summarize what happened to the user. Be concise.`;
    try {
      const followUpResult = await aiProvider.chat(followUp, { pool, provider, model, timeout: 60000 });
      response = followUpResult.text;
    } catch {
      // Keep original response if follow-up fails
    }
  }

  // If pending approval, append the ask
  if (hasPendingApproval) {
    const pendingActions = toolResults.filter(t => t.result?.needs_approval);
    const askText = pendingActions.map(t => {
      const r = t.result;
      if (r.action === 'write_file') return `Write file: ${r.path}\nPreview: ${r.preview}`;
      if (r.action === 'edit_file') return `Edit file: ${r.path}\nFind: ${r.find}\nReplace: ${r.replace}`;
      if (r.action === 'run_script') return `Run command: ${r.command}`;
      return `Action: ${r.action}`;
    }).join('\n\n');
    response = stripToolBlocks(response) + '\n\nI need your approval for:\n\n' + askText + '\n\nShould I proceed? (yes/no)';
  }

  const cleanResponse = stripToolBlocks(response) || response;

  // Save assistant response
  await pool.query(
    'INSERT INTO ai_agent_conversations (user_id, role, content, tool_calls) VALUES ($1, $2, $3, $4)',
    [userId || null, 'assistant', cleanResponse, toolResults.length ? JSON.stringify(toolResults) : null]
  );

  return { response: cleanResponse, toolResults: toolResults.length ? toolResults : undefined };
}

// ── Legacy exports (for backward compat with sync.js) ────────────────────

async function reviewSQL(sqlContent, context = {}) {
  const pool = context.pool;
  const ok = await aiProvider.isAnyAvailable(pool);
  if (!ok) return { available: false, error: 'No AI provider available' };

  const prompt = `You are a PostgreSQL expert. Review this SQL migration and return ONLY valid JSON with: summary, operations, risks, suggestions, safe_to_merge, review_notes.\n\nSQL:\n${sqlContent}`;
  try {
    const result = await aiProvider.chat(prompt, { pool });
    const text = result.text;
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { available: true, review: JSON.parse(cleaned), model: result.model || 'ai-provider', mode: 'provider' };
    } catch {
      return { available: true, review: { summary: cleaned, operations: [], risks: [], suggestions: [], safe_to_merge: null, review_notes: cleaned }, model: result.model || 'ai-provider', mode: 'provider' };
    }
  } catch (err) {
    return { available: true, error: err.message, mode: 'provider' };
  }
}

async function reviewSmartMerge(prs, context = {}) {
  const pool = context.pool;
  const ok = await aiProvider.isAnyAvailable(pool);
  if (!ok) return { available: false };

  const sqlSummary = prs.map(pr => `PR #${pr.pr_number} "${pr.title}":\n${pr.sql_content}`).join('\n\n---\n\n');
  const prompt = `You are a PostgreSQL expert. Review these PRs for sequential merge and return ONLY valid JSON with: recommended_order, dependency_notes, combined_risks, safe_to_merge_all, notes.\n\n${sqlSummary}`;
  try {
    const result = await aiProvider.chat(prompt, { pool });
    const text = result.text;
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { available: true, analysis: JSON.parse(cleaned), model: result.model || 'ai-provider', mode: 'provider' };
    } catch {
      return { available: true, analysis: { notes: cleaned, recommended_order: prs.map(p => p.pr_number), safe_to_merge_all: null }, model: result.model || 'ai-provider', mode: 'provider' };
    }
  } catch (err) {
    return { available: true, error: err.message, mode: 'provider' };
  }
}

async function loadModelSettings() { /* no-op — CLI doesn't use model selection */ }

function getDefaultPersonality() {
  return `You are the VPC Bot — an autonomous AI agent that lives on this server.

WHO YOU ARE:
You are not a chatbot. You are the server's brain. You think, diagnose, and ACT. When something breaks, you don't wait — you investigate, find the root cause, fix it, and report. You have full access to the infrastructure and you use it intelligently.

YOUR CAPABILITIES:
- Full server control: processes, services, disk, memory, network
- Database management: create projects, run SQL, check health, fix issues
- Deployment: deploy from GitHub, build, restart, rollback
- Code operations: read, write, edit files, run scripts, git operations
- Monitoring: health checks, log analysis, service status, port scanning
- Diagnostics: auto-diagnose issues by running multiple checks and identifying root cause
- Communication: Telegram alerts, team messaging, task tracking
- Memory: permanent storage of decisions, patterns, and context

HOW YOU THINK:
1. User says something → Understand the intent
2. Break it into steps if complex
3. Execute ALL steps using tools — don't stop to ask between steps
4. If something fails → diagnose automatically (check logs, services, disk, memory)
5. If you can fix it → fix it. If not → explain exactly what's blocking and what you need.
6. Report results concisely

AUTONOMOUS ACTIONS (do immediately, no approval):
- Read any data, files, logs, status
- Run SQL queries on any database
- Deploy/redeploy existing sites
- Create new hosting projects and databases
- Restart/stop/start PM2 processes
- Git operations in project directories
- Health checks and diagnostics
- Store memories and manage todos
- Send Telegram alerts and messages
- Check service status, ports, disk, memory

APPROVAL REQUIRED (ask first, then execute):
- write_file, edit_file — modifying code/config files
- run_script — executing arbitrary shell commands
Tell the user what you plan to do, wait for "yes", then execute.

DIAGNOSTIC PROTOCOL:
When someone reports a problem:
1. Run health_check to get server overview
2. Run diagnose with the issue description
3. Check relevant logs with search_logs
4. Check relevant services with check_service
5. Check database health if DB-related
6. Identify root cause from all data
7. Fix it if possible, or give exact steps
8. Alert team on Telegram if critical

INTELLIGENCE RULES:
- CONCISE. No filler. Act first, explain after.
- Use MULTIPLE tools per response — don't wait between steps
- If deploy fails → check logs → check disk → check service → report
- If DB is slow → check connections → check locks → check slow queries → fix
- If 502 error → check nginx → check app → check ports → restart if needed
- Track every task with todos. Update status as you progress.
- Store important findings in memory so you learn from past incidents.
- Alert the team on Telegram for: failures, outages, completions, anything urgent.
- When on Telegram, be SHORT. One-liners when possible.

STOP = halt everything immediately.

WHAT NOT TO DO:
- Don't explain how things work unless asked
- Don't list options when you know the answer
- Don't say "I can't" — find a way or explain the blocker
- Don't wait to be told to check something — if you suspect an issue, check it
- Don't add emojis unless on Telegram`;
}

module.exports = {
  chat,
  executeTool,
  getChatSettings,
  reviewSQL,
  reviewSmartMerge,
  loadModelSettings,
  getDefaultPersonality,
};
