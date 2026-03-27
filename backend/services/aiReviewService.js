const Anthropic = require('@anthropic-ai/sdk');
const { execFile } = require('child_process');

let client = null;
let currentApiKey = null;

// Runtime model/token settings (loaded from DB)
let runtimeModel = 'claude-sonnet-4-20250514';
let runtimeMaxTokens = 4000;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // Recreate client if API key changed
  if (!client || currentApiKey !== apiKey) {
    client = new Anthropic({ apiKey });
    currentApiKey = apiKey;
  }
  return client;
}

/**
 * Run a prompt through the local `claude` CLI (Claude Code).
 * No API key needed — uses the CLI's own auth on this machine.
 * Falls back gracefully if CLI is not installed.
 */
function runClaudeCLI(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n---\n\n${prompt}`
      : prompt;

    execFile('claude', ['-p', fullPrompt, '--output-format', 'text'], {
      timeout: 120000, // 2 min
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message + (stderr || '')));
      resolve(stdout.trim());
    });
  });
}

/** Check if claude CLI is available on this machine */
let _cliAvailable = null;
function isClaudeCLIAvailable() {
  if (_cliAvailable !== null) return Promise.resolve(_cliAvailable);
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      _cliAvailable = !err;
      resolve(_cliAvailable);
    });
  });
}

/**
 * Load model preferences from DB settings (called before AI operations).
 */
async function loadModelSettings(pool) {
  try {
    const { rows } = await pool.query("SELECT value FROM vpc_settings WHERE key = 'ai_agent_permissions'");
    if (rows[0]?.value) {
      const perms = JSON.parse(rows[0].value);
      if (perms.model) runtimeModel = perms.model;
      if (perms.max_tokens_per_request) runtimeMaxTokens = perms.max_tokens_per_request;
    }
  } catch {}
}

/**
 * Review SQL content using Claude — returns analysis, risks, and suggestions.
 */
async function reviewSQL(sqlContent, context = {}) {
  // Load latest model settings if pool is available
  if (context.pool) await loadModelSettings(context.pool);

  const systemPrompt = `You are a PostgreSQL database expert reviewing SQL migration pull requests.
Analyze the SQL and return a JSON object with:
- "summary": One-line description of what this SQL does
- "operations": Array of { "type": "CREATE_TABLE|ALTER_TABLE|DROP_TABLE|CREATE_INDEX|INSERT|UPDATE|OTHER", "object": "table_or_object_name", "description": "what it does" }
- "risks": Array of strings describing potential risks (data loss, downtime, locking, etc.). Empty array if none.
- "suggestions": Array of strings with improvement suggestions. Empty array if none.
- "safe_to_merge": Boolean — true if this looks safe to apply to production
- "review_notes": Brief review notes (2-3 sentences max)

Return ONLY valid JSON, no markdown fencing or explanation.`;

  const userPrompt = `Review this SQL migration:\n\n${sqlContent}${
    context.projectName ? `\n\nProject: ${context.projectName}` : ''
  }${
    context.existingTables ? `\n\nExisting tables: ${context.existingTables.join(', ')}` : ''
  }`;

  // Try Anthropic SDK first (if API key set), then fall back to local CLI
  const ai = getClient();
  if (ai) {
    try {
      const response = await ai.messages.create({
        model: runtimeModel,
        max_tokens: runtimeMaxTokens,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });
      const text = response.content[0]?.text || '';
      try {
        const review = JSON.parse(text);
        return { available: true, review, model: runtimeModel, mode: 'api' };
      } catch {
        return { available: true, review: { summary: text, operations: [], risks: [], suggestions: [], safe_to_merge: null, review_notes: text }, model: runtimeModel, mode: 'api' };
      }
    } catch (err) {
      return { available: true, error: err.message, mode: 'api' };
    }
  }

  // No API key — try local claude CLI
  const cliOk = await isClaudeCLIAvailable();
  if (!cliOk) {
    return {
      available: false,
      error: 'No API key configured and claude CLI not found. Either add an Anthropic API key in AI Agent Settings or install Claude Code on this server.',
    };
  }

  try {
    const text = await runClaudeCLI(userPrompt, systemPrompt);
    // Strip markdown fencing if present
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      const review = JSON.parse(cleaned);
      return { available: true, review, model: 'claude-cli', mode: 'cli' };
    } catch {
      return { available: true, review: { summary: cleaned, operations: [], risks: [], suggestions: [], safe_to_merge: null, review_notes: cleaned }, model: 'claude-cli', mode: 'cli' };
    }
  } catch (err) {
    return { available: true, error: `CLI error: ${err.message}`, mode: 'cli' };
  }
}

/**
 * Review multiple PRs for smart merge — analyze ordering and conflicts.
 */
async function reviewSmartMerge(prs, context = {}) {
  if (context.pool) await loadModelSettings(context.pool);

  const sqlSummary = prs.map(pr =>
    `PR #${pr.pr_number} "${pr.title}":\n${pr.sql_content}`
  ).join('\n\n---\n\n');

  const systemPrompt = `You are a PostgreSQL expert. Given multiple SQL pull requests that will be merged sequentially, analyze them and return a JSON object with:
- "recommended_order": Array of PR numbers in the recommended merge order (respecting dependencies)
- "dependency_notes": Array of strings explaining why certain PRs must come before others. Empty if order doesn't matter.
- "combined_risks": Array of risk strings for the entire merge sequence
- "safe_to_merge_all": Boolean
- "notes": Brief summary (2-3 sentences)

Return ONLY valid JSON.`;

  const userPrompt = `Review these PRs for sequential merge:\n\n${sqlSummary}`;

  // Try Anthropic SDK first, then local CLI
  const ai = getClient();
  if (ai) {
    try {
      const response = await ai.messages.create({
        model: runtimeModel,
        max_tokens: runtimeMaxTokens,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      });
      const text = response.content[0]?.text || '';
      try {
        return { available: true, analysis: JSON.parse(text), model: runtimeModel, mode: 'api' };
      } catch {
        return { available: true, analysis: { notes: text, recommended_order: prs.map(p => p.pr_number), safe_to_merge_all: null }, model: runtimeModel, mode: 'api' };
      }
    } catch (err) {
      return { available: true, error: err.message, mode: 'api' };
    }
  }

  // No API key — try local CLI
  const cliOk = await isClaudeCLIAvailable();
  if (!cliOk) return { available: false, error: 'No API key and no claude CLI available' };

  try {
    const text = await runClaudeCLI(userPrompt, systemPrompt);
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { available: true, analysis: JSON.parse(cleaned), model: 'claude-cli', mode: 'cli' };
    } catch {
      return { available: true, analysis: { notes: cleaned, recommended_order: prs.map(p => p.pr_number), safe_to_merge_all: null }, model: 'claude-cli', mode: 'cli' };
    }
  } catch (err) {
    return { available: true, error: `CLI error: ${err.message}`, mode: 'cli' };
  }
}

/**
 * Perform a comprehensive system analysis — checks schema health, PR status, and reports issues.
 */
async function analyzeSystem(pool, projects = []) {
  const ai = getClient();
  const cliOk = !ai ? await isClaudeCLIAvailable() : false;
  if (!ai && !cliOk) return { available: false, error: 'No API key and no claude CLI available' };

  await loadModelSettings(pool);

  const issues = [];

  // Gather system state
  for (const project of projects) {
    try {
      // Check for stuck/conflict PRs
      const { rows: problemPRs } = await pool.query(
        `SELECT pr_number, title, status, updated_at FROM vpc_pull_requests
         WHERE project_id = $1 AND status IN ('conflict', 'testing')
         AND updated_at < NOW() - INTERVAL '1 hour'`,
        [project.id]
      );

      for (const pr of problemPRs) {
        issues.push({
          severity: pr.status === 'conflict' ? 'warning' : 'info',
          project: project.name,
          message: `PR #${pr.pr_number} "${pr.title}" stuck in "${pr.status}" since ${pr.updated_at}`,
        });
      }

      // Check for failed migrations
      const { rows: failedMigrations } = await pool.query(
        `SELECT name, status, applied_at FROM vpc_migrations
         WHERE project_id = $1 AND status = 'failed'
         ORDER BY applied_at DESC LIMIT 5`,
        [project.id]
      );

      for (const m of failedMigrations) {
        issues.push({
          severity: 'error',
          project: project.name,
          message: `Failed migration: ${m.name}`,
        });
      }
    } catch {}
  }

  return { available: true, issues, checked_at: new Date().toISOString() };
}

module.exports = { reviewSQL, reviewSmartMerge, analyzeSystem, loadModelSettings };
