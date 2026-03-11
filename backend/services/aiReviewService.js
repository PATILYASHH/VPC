const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Review SQL content using Claude — returns analysis, risks, and suggestions.
 */
async function reviewSQL(sqlContent, context = {}) {
  const ai = getClient();
  if (!ai) {
    return {
      available: false,
      error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file to enable AI review.',
    };
  }

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

  try {
    const response = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = response.content[0]?.text || '';
    try {
      const review = JSON.parse(text);
      return { available: true, review };
    } catch {
      return { available: true, review: { summary: text, operations: [], risks: [], suggestions: [], safe_to_merge: null, review_notes: text } };
    }
  } catch (err) {
    return { available: true, error: err.message };
  }
}

/**
 * Review multiple PRs for smart merge — analyze ordering and conflicts.
 */
async function reviewSmartMerge(prs, context = {}) {
  const ai = getClient();
  if (!ai) return { available: false };

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

  try {
    const response = await ai.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: `Review these PRs for sequential merge:\n\n${sqlSummary}` }],
      system: systemPrompt,
    });

    const text = response.content[0]?.text || '';
    try {
      return { available: true, analysis: JSON.parse(text) };
    } catch {
      return { available: true, analysis: { notes: text, recommended_order: prs.map(p => p.pr_number), safe_to_merge_all: null } };
    }
  } catch (err) {
    return { available: true, error: err.message };
  }
}

module.exports = { reviewSQL, reviewSmartMerge };
