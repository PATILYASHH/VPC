const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const syncService = require('../services/syncService');
const pullService = require('../services/pullService');
const banadbService = require('../services/banadbService');
const prService = require('../services/prService');
const aiReviewService = require('../services/aiReviewService');
const telegramService = require('../services/telegramService');

/**
 * Helper: get decrypt function from settings route.
 */
function getDecrypt() {
  try {
    const settingsRoute = require('./settings');
    return settingsRoute.decrypt;
  } catch { return () => null; }
}

/**
 * Fire-and-forget Telegram notification.
 */
function notify(pool, eventType, payload) {
  telegramService.notifyIfEnabled(pool, getDecrypt(), eventType, payload).catch(() => {});
}

/**
 * Resolve project by ID and attach to req.
 */
async function resolveProject(req, res, next) {
  try {
    const project = await banadbService.getProject(req.app.locals.pool, req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    req.project = project;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Summary (landing page) ────────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    const { rows } = await req.app.locals.pool.query(`
      SELECT project_id,
        COUNT(*) FILTER (WHERE status = 'open') AS open_prs,
        COUNT(*) FILTER (WHERE status = 'merged') AS merged_prs,
        COUNT(*) FILTER (WHERE status = 'conflict') AS conflict_prs
      FROM vpc_pull_requests GROUP BY project_id
    `);
    res.json({ summaries: rows });
  } catch (err) {
    // Table may not exist yet
    res.json({ summaries: [] });
  }
});

// ─── Pull Requests ─────────────────────────────────────────

router.get('/projects/:id/pull-requests', resolveProject, async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const result = await prService.getPullRequests(req.app.locals.pool, req.project.id, {
      status,
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/pull-requests/:num', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });
    res.json(pr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests', resolveProject, async (req, res) => {
  try {
    const { title, description, sql_content } = req.body;
    if (!title || !sql_content) return res.status(400).json({ error: 'title and sql_content are required' });

    const pr = await prService.createPullRequest(req.app.locals.pool, {
      projectId: req.project.id,
      title,
      description,
      sqlContent: sql_content,
      submittedBy: req.admin?.username || 'vpshub',
    });

    // Notify via Telegram
    notify(req.app.locals.pool, 'pr_created', {
      event: 'created', pr, project: req.project,
    });

    res.status(201).json(pr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/test', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.testPullRequest(req.app.locals.pool, req.project, pr.id);

    // Notify via Telegram
    if (result.sandbox_result?.success && !result.conflict_result?.has_conflicts) {
      notify(req.app.locals.pool, 'pr_test_passed', {
        event: 'test_passed', pr, project: req.project,
      });
    } else if (!result.sandbox_result?.success) {
      notify(req.app.locals.pool, 'pr_test_failed', {
        event: 'test_failed', pr, project: req.project,
        extra: { error: result.sandbox_result?.error },
      });
    } else if (result.conflict_result?.has_conflicts) {
      notify(req.app.locals.pool, 'pr_conflict', {
        event: 'conflict', pr, project: req.project,
        extra: { conflicts: result.conflict_result.conflicts },
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/merge', resolveProject, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const pr = await prService.getPullRequestByNumber(pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    // If sandbox hasn't been run yet, auto-run it before merging
    if (!pr.sandbox_result) {
      try {
        await prService.testPullRequest(pool, req.project, pr.id);
        // Re-fetch PR after test
        const freshPR = await prService.getPullRequest(pool, pr.id);
        if (!freshPR.sandbox_result?.success) {
          return res.status(400).json({
            error: `Sandbox test failed: ${freshPR.sandbox_result?.error || 'Unknown error'}. Fix the SQL and try again.`,
            sandbox_result: freshPR.sandbox_result,
          });
        }
      } catch (testErr) {
        return res.status(400).json({ error: `Sandbox test failed: ${testErr.message}` });
      }
    }

    const result = await prService.mergePullRequest(
      pool, req.project, pr.id, req.admin?.username || 'vpshub'
    );

    // Notify via Telegram
    notify(pool, 'pr_merged', {
      event: 'merged', pr: result.pr || pr, project: req.project,
      extra: { mergedBy: req.admin?.username },
    });

    res.json(result);
  } catch (err) {
    // Return 400 for user-fixable errors, 500 for server errors
    const userErrors = ['Already merged', 'Cannot merge a closed PR', 'Sandbox test must pass', 'Merge blocked'];
    const isUserError = userErrors.some(msg => err.message.includes(msg));
    res.status(isUserError ? 400 : 500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/close', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.closePullRequest(req.app.locals.pool, pr.id, req.admin?.username || 'vpshub');

    notify(req.app.locals.pool, 'pr_closed', {
      event: 'closed', pr, project: req.project,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/pull-requests/:num/reopen', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    const result = await prService.reopenPullRequest(req.app.locals.pool, pr.id);

    notify(req.app.locals.pool, 'pr_reopened', {
      event: 'reopened', pr, project: req.project,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze PR SQL (parse operations) ─────────────────────

router.post('/projects/:id/pull-requests/:num/analyze', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    // Parse DDL operations from the SQL
    const operations = prService.parseDDLOperations(pr.sql_content);

    // Get current schema for context
    let existingTables = [];
    try {
      const projectPool = banadbService.getProjectPool(req.project);
      const snapshot = await syncService.getSchemaSnapshot(projectPool);
      existingTables = snapshot.tables.map(t => t.name);
    } catch {}

    // Categorize operations
    const creates = operations.filter(o => o.type === 'CREATE_TABLE');
    const drops = operations.filter(o => o.type === 'DROP_TABLE');
    const alters = operations.filter(o => o.type.startsWith('ADD_') || o.type.startsWith('DROP_'));
    const indexes = operations.filter(o => o.type === 'CREATE_INDEX');
    const other = operations.filter(o => o.type === 'OTHER');

    res.json({
      operations,
      summary: {
        total_statements: operations.length,
        creates: creates.length,
        drops: drops.length,
        alters: alters.length,
        indexes: indexes.length,
        other: other.length,
      },
      existing_tables: existingTables,
      sql_content: pr.sql_content,
      sql_down: pr.sql_down,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Review (Claude) ────────────────────────────────────

router.post('/projects/:id/pull-requests/:num/review', resolveProject, async (req, res) => {
  try {
    const pr = await prService.getPullRequestByNumber(req.app.locals.pool, req.project.id, req.params.num);
    if (!pr) return res.status(404).json({ error: 'Pull request not found' });

    // Get existing tables for context
    let existingTables = [];
    try {
      const projectPool = banadbService.getProjectPool(req.project);
      const snapshot = await syncService.getSchemaSnapshot(projectPool);
      existingTables = snapshot.tables.map(t => t.name);
    } catch {}

    const result = await aiReviewService.reviewSQL(pr.sql_content, {
      projectName: req.project.name,
      existingTables,
    });

    // Notify via Telegram with review results
    if (result.available && result.review) {
      notify(req.app.locals.pool, 'pr_reviewed', {
        event: 'reviewed', pr, project: req.project,
        extra: { review: result.review },
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Fix stuck PRs (applied migration but status not updated) ─

router.post('/projects/:id/pull-requests/fix-stuck', resolveProject, async (req, res) => {
  try {
    const result = await prService.fixStuckPRs(req.app.locals.pool, req.project.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Smart Merge ───────────────────────────────────────────

router.post('/projects/:id/smart-merge', resolveProject, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const mergedBy = req.admin?.username || 'vpshub';

    // Get all open PRs (ordered by PR number)
    const { pull_requests: openPRs } = await prService.getPullRequests(pool, req.project.id, { status: 'open', limit: 200 });

    // Also include PRs with 'testing' or 'conflict' status that might have been retested
    const { pull_requests: testingPRs } = await prService.getPullRequests(pool, req.project.id, { status: 'testing', limit: 200 });

    let allPRs = [...openPRs, ...testingPRs].sort((a, b) => a.pr_number - b.pr_number);

    if (allPRs.length === 0) {
      return res.json({ success: true, message: 'No open pull requests to merge', merged: [], failed: [] });
    }

    // Optional: Use Claude to analyze merge order
    let aiAnalysis = null;
    if (req.body.useAI) {
      aiAnalysis = await aiReviewService.reviewSmartMerge(allPRs, { projectName: req.project.name });
      if (aiAnalysis.available && aiAnalysis.analysis?.recommended_order) {
        // Reorder PRs based on AI recommendation
        const orderMap = {};
        aiAnalysis.analysis.recommended_order.forEach((num, idx) => { orderMap[num] = idx; });
        allPRs.sort((a, b) => (orderMap[a.pr_number] ?? 999) - (orderMap[b.pr_number] ?? 999));
      }
    }

    const results = { merged: [], failed: [], skipped: [], ai_analysis: aiAnalysis?.analysis || null };

    for (const pr of allPRs) {
      try {
        // Step 1: Test in sandbox
        const testResult = await prService.testPullRequest(pool, req.project, pr.id);

        if (!testResult.sandbox_result?.success) {
          results.failed.push({
            pr_number: pr.pr_number,
            title: pr.title,
            error: `Sandbox test failed: ${testResult.sandbox_result?.error || 'Unknown error'}`,
            step: 'test',
          });
          continue; // Skip this PR, try next
        }

        if (testResult.conflict_result?.has_conflicts) {
          results.failed.push({
            pr_number: pr.pr_number,
            title: pr.title,
            error: `Conflicts detected: ${testResult.conflict_result.conflicts.map(c => c.message).join('; ')}`,
            step: 'conflict_check',
          });
          continue;
        }

        // Step 2: Merge
        // Re-fetch the PR since test updates it
        const freshPR = await prService.getPullRequest(pool, pr.id);
        const mergeResult = await prService.mergePullRequest(pool, req.project, freshPR.id, mergedBy);

        results.merged.push({
          pr_number: pr.pr_number,
          title: pr.title,
          migration_id: mergeResult.migration?.id,
        });
      } catch (err) {
        results.failed.push({
          pr_number: pr.pr_number,
          title: pr.title,
          error: err.message,
          step: 'merge',
        });
        // Continue trying remaining PRs
      }
    }

    results.success = results.failed.length === 0;
    results.message = results.merged.length > 0
      ? `Merged ${results.merged.length} PR(s)${results.failed.length > 0 ? `, ${results.failed.length} failed` : ''}`
      : 'No PRs could be merged';

    // Notify via Telegram
    notify(pool, 'smart_merge', {
      event: 'smart_merge', pr: { pr_number: 0, title: 'Smart Merge' }, project: req.project,
      extra: { results },
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tracking Management ───────────────────────────────────

router.post('/projects/:id/tracking/reinstall', resolveProject, async (req, res) => {
  try {
    await pullService.installPullTracking(req.app.locals.pool, req.project);
    res.json({ success: true, message: 'DDL tracking reinstalled with permissions granted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/tracking/repair', resolveProject, async (req, res) => {
  try {
    await pullService.repairTrackingPermissions(req.project);
    res.json({ success: true, message: 'Tracking permissions repaired for ' + req.project.db_user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/tracking/status', resolveProject, async (req, res) => {
  try {
    const status = await pullService.getPullTrackingStatus(req.app.locals.pool, req.project);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Migrations ────────────────────────────────────────────

router.get('/projects/:id/migrations', resolveProject, async (req, res) => {
  try {
    const { page, limit, status } = req.query;
    const result = await syncService.getMigrations(req.app.locals.pool, req.project.id, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 50, 200),
      status,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/migrations/:mid', resolveProject, async (req, res) => {
  try {
    const migration = await syncService.getMigration(req.app.locals.pool, req.params.mid);
    if (!migration) return res.status(404).json({ error: 'Migration not found' });
    res.json(migration);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/projects/:id/migrations/:mid/rollback', resolveProject, async (req, res) => {
  try {
    const result = await syncService.rollbackMigration(req.app.locals.pool, req.project, req.params.mid);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/changes', resolveProject, async (req, res) => {
  try {
    if (!req.project.pull_tracking_enabled) {
      return res.json({ changes: [], total: 0, tracking_enabled: false });
    }
    const projectPool = banadbService.getProjectPool(req.project);
    const sinceId = parseInt(req.query.since) || 0;
    const result = await pullService.getSchemaChanges(projectPool, sinceId);
    res.json({ ...result, tracking_enabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/schema', resolveProject, async (req, res) => {
  try {
    const projectPool = banadbService.getProjectPool(req.project);
    const snapshot = await syncService.getSchemaSnapshot(projectPool);
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Extension Download ────────────────────────────────────

router.get('/extension/download', (req, res) => {
  const vsixPath = path.join(__dirname, '..', '..', 'downloads', 'vpc-sync.vsix');
  if (!fs.existsSync(vsixPath)) {
    return res.status(404).json({ error: 'Extension file not available' });
  }
  res.download(vsixPath, 'vpc-sync.vsix');
});

module.exports = router;
