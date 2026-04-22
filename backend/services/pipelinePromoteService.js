/**
 * Pipeline promote — "1-click beta → prod" with:
 *   - Preflight (diff + last-backup age + deploy count, no changes)
 *   - Staged execute: snapshot → apply schema → deploy sites
 *   - Rollback on failure (auto-restore snapshot)
 *   - Live progress via realtimeBus channel 'pipeline:promote:<id>'
 */

const syncService = require('./syncService');
const dbService = require('./dbService');
const dbForkService = require('./dbForkService');
const webHostingService = require('./webHostingService');
const backupService = require('./backupService');
const pipelineService = require('./pipelineService');
const bus = require('./realtimeBus');

function channel(pipelineId) { return `pipeline:promote:${pipelineId}`; }

// ─── Preflight: analyze, don't apply ─────────────────────────
async function preflight(pool, pipelineId) {
  const resolved = await pipelineService.getResolved(pool, pipelineId);
  if (!resolved) throw new Error('Pipeline not found');

  const plan = {
    pipeline_id: pipelineId,
    pipeline_name: resolved.pipeline?.name,
    schema: { hasChanges: false, summary: null, diff: null, sql: null, prodDb: null, betaDb: null },
    hosting: { redeployCount: resolved.production.hosting.length, sites: resolved.production.hosting.map(s => ({ id: s.id, name: s.name })) },
    backup: { lastAt: null, ageMinutes: null, stale: true },
    blockers: [],
    warnings: [],
  };

  // Schema diff
  if (resolved.production.databases.length > 0 && resolved.beta.databases.length > 0) {
    const prodDb = resolved.production.databases[0];
    const betaDb = resolved.beta.databases[0];
    plan.schema.prodDb = { id: prodDb.id, name: prodDb.name };
    plan.schema.betaDb = { id: betaDb.id, name: betaDb.name };
    try {
      const prodPool = dbService.getProjectPool(prodDb);
      const betaPool = dbService.getProjectPool(betaDb);
      const [prodSnap, betaSnap] = await Promise.all([
        syncService.getSchemaSnapshot(prodPool),
        syncService.getSchemaSnapshot(betaPool),
      ]);
      const diff = dbForkService.diffSchemas(prodSnap, betaSnap);
      const sql = dbForkService.generatePromoteSQL(diff);
      plan.schema.diff = diff;
      plan.schema.summary = diff.summary;
      plan.schema.sql = sql || null;
      plan.schema.hasChanges = Boolean(sql && sql.trim());
    } catch (err) {
      plan.warnings.push(`Schema diff failed: ${err.message}`);
    }

    // Check last prod backup
    try {
      const { rows } = await pool.query(
        `SELECT created_at FROM backups WHERE database_name = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
        [prodDb.db_name || prodDb.name]
      );
      if (rows.length > 0) {
        plan.backup.lastAt = rows[0].created_at;
        plan.backup.ageMinutes = Math.round((Date.now() - new Date(rows[0].created_at).getTime()) / 60000);
        plan.backup.stale = plan.backup.ageMinutes > 60;
      }
    } catch { /* non-fatal */ }
  } else if (resolved.beta.hosting.length === 0 && resolved.beta.databases.length === 0) {
    plan.blockers.push('Beta environment is empty — nothing to promote.');
  }

  if (!plan.schema.hasChanges && plan.hosting.redeployCount === 0) {
    plan.warnings.push('No schema changes and no production sites to redeploy.');
  }

  return plan;
}

// ─── Executor ─────────────────────────────────────────────────

async function promote(pool, pipelineId, { initiatedBy, confirmations = {}, skipBackup = false, dryRun = false } = {}) {
  const plan = await preflight(pool, pipelineId);
  if (plan.blockers.length > 0) {
    throw new Error(`Cannot promote: ${plan.blockers.join('; ')}`);
  }

  // Persist a promotion record so we can audit + resume/rollback later
  const { rows: insRows } = await pool.query(
    `INSERT INTO vpc_pipeline_promotions (pipeline_id, initiated_by, status, schema_diff, applied_sql)
     VALUES ($1, $2, 'running', $3, $4) RETURNING *`,
    [pipelineId, initiatedBy || null, plan.schema.diff || null, plan.schema.sql || null]
  );
  const run = insRows[0];

  const stages = [];
  const pushStage = async (name, status, extra = {}) => {
    stages.push({ name, status, ts: new Date().toISOString(), ...extra });
    await pool.query('UPDATE vpc_pipeline_promotions SET stages = $1 WHERE id = $2', [JSON.stringify(stages), run.id]);
    bus.publish(channel(pipelineId), { run_id: run.id, stage: name, status, ...extra });
  };

  const fail = async (stageName, err) => {
    await pushStage(stageName, 'failed', { error: err.message });
    await pool.query(
      `UPDATE vpc_pipeline_promotions SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
      [err.message, run.id]
    );
    bus.publish(channel(pipelineId), { run_id: run.id, status: 'failed', error: err.message });
  };

  if (dryRun) {
    await pushStage('dry_run', 'success', { plan });
    await pool.query(`UPDATE vpc_pipeline_promotions SET status='success', completed_at=NOW() WHERE id=$1`, [run.id]);
    return { run_id: run.id, plan, stages, dryRun: true };
  }

  try {
    await pushStage('start', 'running', { plan_summary: plan.schema.summary });

    // ─── Stage 1: snapshot prod DB (safety net) ─────────────
    let backupId = null;
    if (!skipBackup && plan.schema.prodDb) {
      await pushStage('backup', 'running', { db: plan.schema.prodDb.name });
      try {
        const backup = await backupService.runBackup(pool, {
          database: plan.schema.prodDb.name,
          backupType: 'full',
          initiatedBy,
          notes: `Pre-promote snapshot for pipeline ${plan.pipeline_name}`,
        });
        if (backup.status !== 'completed') throw new Error(backup.error_message || 'backup failed');
        backupId = backup.id;
        await pool.query('UPDATE vpc_pipeline_promotions SET backup_id=$1 WHERE id=$2', [backupId, run.id]);
        await pushStage('backup', 'success', { backup_id: backupId, bytes: backup.file_size_bytes });
      } catch (err) {
        await fail('backup', err);
        throw err;
      }
    } else {
      await pushStage('backup', 'skipped');
    }

    // ─── Stage 2: apply schema SQL to prod ──────────────────
    if (plan.schema.hasChanges && confirmations.schema !== false) {
      await pushStage('schema', 'running', { statements: (plan.schema.sql.match(/;/g) || []).length });
      try {
        const prodDb = plan.schema.prodDb;
        const prodDbRow = (await pool.query('SELECT * FROM db_projects WHERE id=$1', [prodDb.id])).rows[0];
        const prodPool = dbService.getProjectPool(prodDbRow);
        const client = await prodPool.connect();
        try {
          await client.query('BEGIN');
          await client.query(plan.schema.sql);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        await pushStage('schema', 'success');
      } catch (err) {
        await fail('schema', err);
        await autoRollback(pool, run.id, backupId, plan.schema.prodDb?.name);
        throw err;
      }
    } else {
      await pushStage('schema', 'skipped');
    }

    // ─── Stage 3: redeploy prod hosting sites ───────────────
    const deployed = [];
    const deployErrors = [];
    if (plan.hosting.redeployCount > 0 && confirmations.deploy !== false) {
      await pushStage('deploy', 'running', { sites: plan.hosting.sites });
      const resolved = await pipelineService.getResolved(pool, pipelineId);
      for (const site of resolved.production.hosting) {
        try {
          await webHostingService.deploy(pool, site);
          deployed.push(site.name);
          bus.publish(channel(pipelineId), { run_id: run.id, stage: 'deploy', site: site.name, ok: true });
        } catch (err) {
          deployErrors.push({ site: site.name, error: err.message });
          bus.publish(channel(pipelineId), { run_id: run.id, stage: 'deploy', site: site.name, ok: false, error: err.message });
        }
      }
      webHostingService.refreshSlugCache(pool).catch(() => {});
      webHostingService.refreshDomainCache(pool).catch(() => {});
      await pushStage('deploy', deployErrors.length ? 'partial' : 'success', { deployed, failed: deployErrors });
    } else {
      await pushStage('deploy', 'skipped');
    }

    // ─── Finalize ──────────────────────────────────────────
    const finalStatus = deployErrors.length > 0 ? 'partial' : 'success';
    await pool.query(
      `UPDATE vpc_pipeline_promotions SET status=$1, deployed_sites=$2, completed_at=NOW() WHERE id=$3`,
      [finalStatus, JSON.stringify(deployed), run.id]
    );
    await pipelineService.logActivity(pool, pipelineId, {
      eventType: 'promote_complete',
      resourceType: null,
      resourceName: null,
      environment: 'production',
      message: `Promote ${finalStatus}: schema ${plan.schema.hasChanges ? 'applied' : 'unchanged'}, ${deployed.length} site(s) deployed`,
      metadata: { run_id: run.id, backup_id: backupId },
    });
    bus.publish(channel(pipelineId), { run_id: run.id, status: finalStatus, deployed, deployErrors });

    return {
      run_id: run.id,
      status: finalStatus,
      backup_id: backupId,
      schema_applied: plan.schema.hasChanges,
      deployed,
      deployErrors,
      stages,
    };
  } catch (err) {
    throw err;
  }
}

// ─── Auto-rollback helper ─────────────────────────────────────

async function autoRollback(pool, runId, backupId, prodDbName) {
  if (!backupId) return;
  bus.publish(`pipeline:promote:rollback`, { run_id: runId, backup_id: backupId });
  try {
    await backupService.restore(pool, backupId);
    await pool.query(`UPDATE vpc_pipeline_promotions SET status='rolled_back' WHERE id=$1`, [runId]);
  } catch (err) {
    await pool.query(
      `UPDATE vpc_pipeline_promotions SET error_message = error_message || E'\n[rollback failed: ' || $1 || ']' WHERE id=$2`,
      [err.message, runId]
    );
  }
}

// ─── Manual rollback ──────────────────────────────────────────

async function rollback(pool, runId) {
  const { rows } = await pool.query('SELECT * FROM vpc_pipeline_promotions WHERE id=$1', [runId]);
  if (rows.length === 0) throw new Error('Promotion run not found');
  const run = rows[0];
  if (!run.backup_id) throw new Error('No backup available for this run');

  await backupService.restore(pool, run.backup_id);
  await pool.query(`UPDATE vpc_pipeline_promotions SET status='rolled_back' WHERE id=$1`, [runId]);
  return { ok: true, backup_id: run.backup_id };
}

// ─── List history ────────────────────────────────────────────

async function listRuns(pool, pipelineId) {
  const { rows } = await pool.query(
    `SELECT id, status, stages, backup_id, deployed_sites, error_message, started_at, completed_at, initiated_by
     FROM vpc_pipeline_promotions WHERE pipeline_id = $1 ORDER BY started_at DESC LIMIT 20`,
    [pipelineId]
  );
  return rows;
}

module.exports = { preflight, promote, rollback, listRuns };
