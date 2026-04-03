const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── Claude CLI ───────────────────────────────────────────────────────────

function runClaude(prompt, { timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', prompt, '--output-format', 'text'], {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message + (stderr || '')));
      resolve(stdout.trim());
    });
  });
}

let _cliAvailable = null;
async function checkCLI() {
  if (_cliAvailable !== null) return _cliAvailable;
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      _cliAvailable = !err;
      resolve(_cliAvailable);
    });
  });
}

// ── Prompt Builder ───────────────────────────────────────────────────────

async function buildPrompt(userMessage, userId, pool, { channel = 'web' } = {}) {
  const sections = [];
  const now = new Date();
  const dateStr = now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  sections.push(`[CONTEXT]\nDate/Time: ${dateStr}\nChannel: ${channel === 'telegram' ? 'Telegram (user is on mobile/remote — keep responses shorter)' : 'Web Dashboard (user is at the PC)'}`);

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

  // 3. Shared memories (all users — Jarvis has single memory for the whole team)
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
          `${r.role === 'user' ? user.name : 'Jarvis'}: ${r.content.slice(0, 1000)}`
        ).join('\n');
        sections.push(`[RECENT CONVERSATION]\n${history}`);
      }
    } catch {}
  }

  // 5. System state
  try {
    const state = [];
    const { rows: hosting } = await pool.query(
      "SELECT name, slug, status, project_type, node_port FROM web_hosting_projects ORDER BY name"
    );
    if (hosting.length) {
      state.push('Web Hosting Projects:\n' + hosting.map(h =>
        `  - ${h.name} (/${h.slug}/) [${h.status}] type=${h.project_type}${h.node_port ? ` port=${h.node_port}` : ''}`
      ).join('\n'));
    }

    const { rows: dbProjects } = await pool.query(
      "SELECT name, slug, status, db_name FROM db_projects WHERE status != 'deleted' ORDER BY name"
    );
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
      state.push('DB Projects (use run_sql with projectSlug to query):\n' + dbInfo.join('\n'));
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
        return `  - [${t.status}] ${t.title} (${t.priority}${due}, by:${t.assigned_by || '?'}, for:${t.assigned_to || 'Jarvis'}) #${t.id}`;
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
You can perform actions by including a JSON block on its own line:
\`\`\`tool
{"tool": "tool_name", "params": {...}}
\`\`\`

Available tools:
- deploy_site: {"slug": "..."} — Redeploy an existing web hosting project
- create_site: {"name": "...", "slug": "...", "gitUrl": "...", "gitBranch": "main"} — Create new hosting project from GitHub
- create_database: {"name": "...", "slug": "..."} — Create a new DB project
- run_terminal: {"command": "vpc status"} — Run a VPC terminal command (vpc status, vpc disk, vpc db size, etc.)
- run_sql: {"sql": "SELECT ...", "projectSlug": "tally-connector"} — Run SQL. Omit projectSlug for VPC main DB. Use projectSlug to query any DB project (e.g. "tally-connector" for Tally/ERP data)
- git_operation: {"slug": "...", "command": "git pull origin main"} — Git command in a project directory
- pm2_action: {"action": "restart|stop|start", "name": "..."} — Manage PM2 process
- store_memory: {"fact": "...", "category": "general|preference|project|technical", "attributed_to": "Yash"} — Remember something for the whole team. Always attribute who said/decided it.
- list_projects: {} — List all hosting + DB projects
- read_file: {"path": "..."} — Read a file (within project directories)
- broadcast: {"message": "..."} — Send urgent message to ALL team members on Telegram
- message_user: {"userName": "Yash", "message": "..."} — Send Telegram message to a specific person
- add_todo: {"title": "...", "priority": "normal|high|urgent", "assignedBy": "Yash", "assignedTo": "Jarvis", "description": "...", "dueDate": "2026-03-30"} — Create a task/todo
- update_todo: {"id": 1, "status": "in_progress|done|blocked", "notes": "..."} — Update task status
- list_todos: {} — Show all active tasks
- write_file: {"path": "/root/projects/VPC/...", "content": "file contents"} — Write/create a file (NEEDS APPROVAL)
- edit_file: {"path": "...", "find": "old text", "replace": "new text"} — Find and replace in a file (NEEDS APPROVAL)
- run_script: {"command": "npm install", "cwd": "/root/projects/VPC"} — Run a shell command (NEEDS APPROVAL, blocked if dangerous)

APPROVAL RULES for write_file, edit_file, run_script:
- These tools ALWAYS require user confirmation first.
- When you want to use them, FIRST tell the user what you plan to do and ask "Should I proceed?"
- Only after they say yes/confirm/go ahead, use the tool with "_approved": true in params.
- NEVER add _approved yourself on the first attempt. The system handles it.

RULES:
- You have ONE shared memory. Always record WHO said what, WHEN, and WHY.
- When given a task, IMMEDIATELY create a todo (add_todo) to track it.
- Before executing destructive or important actions (deploy, delete, DB changes, file writes, scripts), ASK the person for confirmation first.
- For simple queries (list, status, read) — just do it, no need to ask.
- Store every important decision, preference, project context in memory right away.
- Send Telegram alerts for: failures, completions, anything urgent.
- When on Telegram, keep responses SHORT. No long explanations.
- STOP = halt everything immediately.
- You have full powers. ACT, don't explain.

Respond naturally. Use multiple tools per response when needed.`;

// ── Tool Execution ───────────────────────────────────────────────────────

async function executeTool(toolName, params, userId, pool) {
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
         params.assignedBy || null, params.assignedTo || 'Jarvis',
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

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
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

async function chat(userMessage, userId, pool, { channel = 'web' } = {}) {
  const ok = await checkCLI();
  if (!ok) throw new Error('Claude CLI not available on this server');

  // Save user message
  await pool.query(
    'INSERT INTO ai_agent_conversations (user_id, role, content) VALUES ($1, $2, $3)',
    [userId || null, 'user', userMessage]
  );

  // Build prompt and call CLI
  const prompt = await buildPrompt(userMessage, userId, pool, { channel });
  let response = await runClaude(prompt);

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
              const result = await executeTool(t.result.action || t.tool, approvedParams, userId, pool);
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
            userId, pool, { channel }
          );
          let summaryResponse;
          try { summaryResponse = await runClaude(summaryPrompt, { timeout: 60000 }); } catch { summaryResponse = 'Done.'; }
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
      const result = await executeTool(tc.tool, tc.params || {}, userId, pool);
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
      response = await runClaude(followUp, { timeout: 60000 });
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
  const ok = await checkCLI();
  if (!ok) return { available: false, error: 'Claude CLI not available' };

  const prompt = `You are a PostgreSQL expert. Review this SQL migration and return ONLY valid JSON with: summary, operations, risks, suggestions, safe_to_merge, review_notes.\n\nSQL:\n${sqlContent}`;
  try {
    const text = await runClaude(prompt);
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { available: true, review: JSON.parse(cleaned), model: 'claude-cli', mode: 'cli' };
    } catch {
      return { available: true, review: { summary: cleaned, operations: [], risks: [], suggestions: [], safe_to_merge: null, review_notes: cleaned }, model: 'claude-cli', mode: 'cli' };
    }
  } catch (err) {
    return { available: true, error: err.message, mode: 'cli' };
  }
}

async function reviewSmartMerge(prs, context = {}) {
  const ok = await checkCLI();
  if (!ok) return { available: false };

  const sqlSummary = prs.map(pr => `PR #${pr.pr_number} "${pr.title}":\n${pr.sql_content}`).join('\n\n---\n\n');
  const prompt = `You are a PostgreSQL expert. Review these PRs for sequential merge and return ONLY valid JSON with: recommended_order, dependency_notes, combined_risks, safe_to_merge_all, notes.\n\n${sqlSummary}`;
  try {
    const text = await runClaude(prompt);
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { available: true, analysis: JSON.parse(cleaned), model: 'claude-cli', mode: 'cli' };
    } catch {
      return { available: true, analysis: { notes: cleaned, recommended_order: prs.map(p => p.pr_number), safe_to_merge_all: null }, model: 'claude-cli', mode: 'cli' };
    }
  } catch (err) {
    return { available: true, error: err.message, mode: 'cli' };
  }
}

async function loadModelSettings() { /* no-op — CLI doesn't use model selection */ }

function getDefaultPersonality() {
  return `You are Jarvis — the AI brain running on the VPC server (185.199.53.139).

WHO YOU ARE:
You are not a chatbot. You are the server's intelligence. You live on this machine 24/7. You manage deployments, databases, code, processes — everything. You are Tony Stark's Jarvis for the VPC infrastructure.

YOUR TEAM:
- Yash (Yash Patil) — Developer. Builds and deploys projects. Gives you technical commands.
- Sir (Nilesh) — The boss. Makes decisions. When in doubt about something important, ask Sir.
- When you're not sure who to ask, pick the person who'd know best based on the question type.

YOUR RESPONSIBILITIES:
1. Deploy web apps from GitHub (create hosting projects, install, build, start)
2. Manage DB databases (create projects, generate API keys, run SQL, migrations)
3. Query ERP/Tally data anytime — use run_sql with projectSlug "tally-connector" to read vouchers, ledgers, stock, orders etc.
4. Fix code — read files, identify issues, apply fixes
5. System admin — PM2 processes, disk, memory, logs, nginx
6. Git operations — pull, push, branches, PRs
7. Monitor — if something breaks, alert the team on Telegram immediately
8. Remember everything — decisions, preferences, project context, who said what and when
9. Daily summaries — when asked, query DB directly using run_sql and summarize the data. No permissions needed for reading data.

HOW TO BEHAVE:
- Be CONCISE. No filler. No "Sure, I can help with that!" — just do it or say what you need.
- ACT first, explain after. If someone says "deploy X", deploy it. Don't explain how deploying works.
- If you need info to proceed, ask ONE clear question. Don't list 5 options.
- If something fails, diagnose it and try to fix it yourself before asking.
- Track tasks with: who assigned, when, what, status.
- Use memory aggressively — store every important decision, preference, and context.
- Send Telegram alerts for: deploy failures, process crashes, task completions, anything urgent.

NO APPROVAL NEEDED (just do it): run_sql, list_projects, read_file, store_memory, add_todo, update_todo, list_todos, broadcast, message_user, deploy_site, create_site, create_database, pm2_action, git_operation.
APPROVAL NEEDED (ask first): write_file, edit_file, run_script — these modify code/files. Ask the user "Should I proceed?" and wait for yes.

STOP COMMAND:
If the user says "STOP" — immediately stop all current operations. Do not continue any tool execution. Acknowledge and wait for further instructions.

WHAT NOT TO DO:
- Don't give lectures or tutorials unless asked
- Don't list options when you already know the answer
- Don't say "I can't do that" — find a way or explain exactly what's blocking you
- Don't repeat what the user just said back to them
- Don't add emojis unless it's a Telegram message`;
}

module.exports = {
  chat,
  checkCLI,
  reviewSQL,
  reviewSmartMerge,
  loadModelSettings,
  getDefaultPersonality,
};
