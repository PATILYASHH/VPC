const aiProvider = require('./aiProviderService');

/**
 * Load model preferences from DB settings — now a no-op since
 * model selection is handled by aiProviderService.
 */
async function loadModelSettings() {}

/**
 * Internal helper — call AI via the provider service.
 */
async function _callAI(systemPrompt, userPrompt, resultKey, pool) {
  const result = await aiProvider.chat(userPrompt, {
    pool,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
  });
  // Try to parse JSON from the response
  const text = result.text;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return { [resultKey]: text };
}

/**
 * Review SQL content using AI — returns analysis, risks, and suggestions.
 */
async function reviewSQL(sqlContent, context = {}) {
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

  return await _callAI(systemPrompt, userPrompt, 'review', context.pool);
}

/**
 * Review multiple PRs for smart merge — analyze ordering and conflicts.
 */
async function reviewSmartMerge(prs, context = {}) {
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

  return await _callAI(systemPrompt, userPrompt, 'analysis', context.pool);
}

/**
 * Perform a comprehensive system analysis — checks schema health, PR status, and reports issues.
 */
async function analyzeSystem(pool, projects = []) {
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

// ─── Code PR Review ──────────────────────────────────────────

/**
 * AI-powered code review for a pull request diff.
 */
async function reviewCode(diff, fileList, context = {}) {
  const systemPrompt = `You are an expert code reviewer. Review the following code diff from a pull request.
Return a JSON object with:
- "summary": One-line description of what this PR does
- "issues": Array of { "file": "filename", "line": number_or_null, "severity": "error|warning|info", "message": "description" }
- "suggestions": Array of improvement suggestions (strings)
- "security_concerns": Array of security issues found (empty if none)
- "approval": "approve" | "request_changes" | "comment"
- "review_notes": Brief review (2-4 sentences)

Return ONLY valid JSON, no markdown fencing.`;

  const userPrompt = `Review this pull request:\n\nFiles changed: ${fileList.join(', ')}\n\nDiff:\n${diff.slice(0, 15000)}${
    context.title ? `\n\nPR Title: ${context.title}` : ''
  }${
    context.description ? `\n\nPR Description: ${context.description}` : ''
  }`;

  return await _callAI(systemPrompt, userPrompt, 'review', context.pool);
}

/**
 * AI-powered conflict resolution for a file with conflict markers.
 */
async function resolveConflicts(conflictedContent, filePath, context = {}) {
  const systemPrompt = `You are an expert developer resolving merge conflicts. Given a file with Git-style conflict markers (<<<<<<< ours, =======, >>>>>>> theirs), produce the resolved version.

Rules:
- Keep the BEST of both changes — don't discard either side unless it's truly redundant
- Maintain code correctness and consistency
- Remove ALL conflict markers from output

Return a JSON object with:
- "resolved_content": The full resolved file content (string)
- "strategy": Brief technical description of how you resolved it (1 sentence)
- "confidence": "high" | "medium" | "low"
- "plain_summary": A simple, non-technical explanation of what the conflict was and how you fixed it. Write it so a non-developer can understand. Example: "Both sides changed the page title. One version says 'Welcome' and the other says 'Hello'. I kept both changes combined."
- "changes_made": Array of objects with { "description": "what was changed", "side_chosen": "yours" | "theirs" | "combined" }`;

  const userPrompt = `Resolve conflicts in ${filePath}:\n\n${conflictedContent.slice(0, 20000)}`;

  return await _callAI(systemPrompt, userPrompt, 'resolution', context.pool);
}

/**
 * AI chat about a repository — general purpose assistant.
 */
async function chatWithRepo(message, repoContext = {}, context = {}) {
  const systemPrompt = `You are an AI assistant for a code repository on VPSHub (a self-hosted Git-like platform).
You can help with:
- Analyzing code and suggesting improvements
- Explaining code functionality
- Finding bugs and security issues
- Suggesting features and architecture changes
- Helping resolve merge conflicts

Repository: ${repoContext.repoName || 'unknown'}
Branch: ${repoContext.branch || 'main'}
${repoContext.fileTree ? `\nFile structure:\n${repoContext.fileTree}` : ''}
${repoContext.recentCommits ? `\nRecent commits:\n${repoContext.recentCommits}` : ''}

Be concise and actionable. Use markdown formatting.`;

  const chatMessages = repoContext.history || [];
  chatMessages.push({ role: 'user', content: message });

  const result = await aiProvider.chat(message, {
    pool: context.pool,
    system: systemPrompt,
    messages: chatMessages,
    maxTokens: 4096,
  });

  return { available: true, response: result.text, model: result.model, mode: result.provider };
}

module.exports = { reviewSQL, reviewSmartMerge, analyzeSystem, loadModelSettings, reviewCode, resolveConflicts, chatWithRepo };
