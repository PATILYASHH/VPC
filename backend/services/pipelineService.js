const dbService = require('./dbService');
const dbForkService = require('./dbForkService');
const syncService = require('./syncService');

// ─── CRUD ────────────────────────────────────────────────────

async function getAll(pool) {
  const { rows: pipelines } = await pool.query(
    'SELECT * FROM vpc_pipelines ORDER BY created_at DESC'
  );

  for (const p of pipelines) {
    const { rows: counts } = await pool.query(
      `SELECT environment, resource_type, COUNT(*)::int AS count
       FROM vpc_pipeline_resources WHERE pipeline_id = $1
       GROUP BY environment, resource_type`,
      [p.id]
    );
    p.resource_counts = { production: { repo: 0, db: 0, hosting: 0 }, beta: { repo: 0, db: 0, hosting: 0 } };
    for (const c of counts) {
      if (p.resource_counts[c.environment]) {
        p.resource_counts[c.environment][c.resource_type] = c.count;
      }
    }
  }

  return pipelines;
}

async function getById(pool, id) {
  const { rows } = await pool.query('SELECT * FROM vpc_pipelines WHERE id = $1', [id]);
  return rows[0] || null;
}

async function create(pool, { name, slug, description, color, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO vpc_pipelines (name, slug, description, color, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, slug, description || '', color || 'blue', createdBy]
  );
  return rows[0];
}

async function update(pool, id, { name, description, color, settings }) {
  const sets = ['updated_at = NOW()'];
  const vals = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); vals.push(description); }
  if (color !== undefined) { sets.push(`color = $${idx++}`); vals.push(color); }
  if (settings !== undefined) { sets.push(`settings = $${idx++}`); vals.push(JSON.stringify(settings)); }

  if (sets.length === 1) return getById(pool, id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE vpc_pipelines SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, vals
  );
  return rows[0];
}

async function remove(pool, id) {
  await pool.query('DELETE FROM vpc_pipelines WHERE id = $1', [id]);
}

// ─── Resources ───────────────────────────────────────────────

async function addResource(pool, pipelineId, { resourceType, resourceId, environment, displayOrder }) {
  const { rows } = await pool.query(
    `INSERT INTO vpc_pipeline_resources (pipeline_id, resource_type, resource_id, environment, display_order)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (pipeline_id, resource_type, resource_id) DO UPDATE SET environment = $4, display_order = $5
     RETURNING *`,
    [pipelineId, resourceType, resourceId, environment || 'production', displayOrder || 0]
  );
  return rows[0];
}

async function removeResource(pool, pipelineId, resourceType, resourceId) {
  await pool.query(
    'DELETE FROM vpc_pipeline_resources WHERE pipeline_id = $1 AND resource_type = $2 AND resource_id = $3',
    [pipelineId, resourceType, resourceId]
  );
}

async function setResources(pool, pipelineId, resources) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM vpc_pipeline_resources WHERE pipeline_id = $1', [pipelineId]);
    for (const r of resources) {
      await client.query(
        `INSERT INTO vpc_pipeline_resources (pipeline_id, resource_type, resource_id, environment, display_order)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [pipelineId, r.resource_type, r.resource_id, r.environment || 'production', r.display_order || 0]
      );
    }
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

// ─── Resolved (enriched with live status) ────────────────────

async function getResolved(pool, pipelineId) {
  const pipeline = await getById(pool, pipelineId);
  if (!pipeline) return null;

  const { rows: links } = await pool.query(
    'SELECT * FROM vpc_pipeline_resources WHERE pipeline_id = $1 ORDER BY environment, resource_type, display_order',
    [pipelineId]
  );

  const repoIds = [...new Set(links.filter(l => l.resource_type === 'repo').map(l => l.resource_id))];
  const dbIds = [...new Set(links.filter(l => l.resource_type === 'db').map(l => l.resource_id))];
  const hostingIds = [...new Set(links.filter(l => l.resource_type === 'hosting').map(l => l.resource_id))];

  const repoMap = new Map();
  const dbMap = new Map();
  const hostingMap = new Map();

  // Repos with owner username
  if (repoIds.length > 0) {
    const { rows } = await pool.query(
      "SELECT r.*, a.username AS owner_username FROM vpshub_repositories r LEFT JOIN vpc_admins a ON a.id = r.owner_id WHERE r.id = ANY($1)",
      [repoIds]
    );
    for (const r of rows) repoMap.set(r.id, r);
  }

  // DBs with storage + connection stats
  if (dbIds.length > 0) {
    const { rows } = await pool.query("SELECT * FROM db_projects WHERE id = ANY($1) AND status != 'deleted'", [dbIds]);
    for (const d of rows) {
      try {
        const { rows: sz } = await pool.query('SELECT pg_database_size($1) AS size_bytes', [d.db_name]);
        d.storage_used_mb = Math.round(parseInt(sz[0]?.size_bytes || 0) / (1024 * 1024));
      } catch { d.storage_used_mb = 0; }
      try {
        const { rows: conn } = await pool.query("SELECT count(*) AS cnt FROM pg_stat_activity WHERE datname = $1", [d.db_name]);
        d.active_connections = parseInt(conn[0]?.cnt || 0);
      } catch { d.active_connections = 0; }
      dbMap.set(d.id, d);
    }
  }

  // Hosting with PM2 status
  if (hostingIds.length > 0) {
    const { rows } = await pool.query("SELECT * FROM web_hosting_projects WHERE id = ANY($1) AND status != 'deleted'", [hostingIds]);
    for (const h of rows) hostingMap.set(h.id, h);
  }

  // Build environment-grouped result
  const production = { repos: [], databases: [], hosting: [] };
  const beta = { repos: [], databases: [], hosting: [] };

  for (const link of links) {
    const env = link.environment === 'beta' ? beta : production;
    const typeKey = link.resource_type === 'repo' ? 'repos' : link.resource_type === 'db' ? 'databases' : 'hosting';
    const dataMap = link.resource_type === 'repo' ? repoMap : link.resource_type === 'db' ? dbMap : hostingMap;
    const resolved = dataMap.get(link.resource_id);
    if (resolved) env[typeKey].push(resolved);
  }

  // Get recent activity
  const { rows: activity } = await pool.query(
    'SELECT * FROM vpc_pipeline_activity WHERE pipeline_id = $1 ORDER BY created_at DESC LIMIT 15',
    [pipelineId]
  );

  // Schema diff between prod and beta DBs (if both exist)
  let schemaDiff = null;
  if (production.databases.length > 0 && beta.databases.length > 0) {
    try {
      const prodPool = dbService.getProjectPool(production.databases[0]);
      const betaPool = dbService.getProjectPool(beta.databases[0]);
      const [prodSnap, betaSnap] = await Promise.all([
        syncService.getSchemaSnapshot(prodPool),
        syncService.getSchemaSnapshot(betaPool),
      ]);
      schemaDiff = dbForkService.diffSchemas(prodSnap, betaSnap);
    } catch { /* ignore diff errors */ }
  }

  return { pipeline, production, beta, activity, schemaDiff };
}

// ─── Available Resources ─────────────────────────────────────

async function getAvailableResources(pool) {
  const [repoResult, dbResult, hostingResult] = await Promise.all([
    pool.query("SELECT r.id, r.name, r.slug, r.visibility, a.username AS owner_username FROM vpshub_repositories r LEFT JOIN vpc_admins a ON a.id = r.owner_id ORDER BY r.name"),
    pool.query("SELECT id, name, slug, status, environment, storage_limit_mb FROM db_projects WHERE status != 'deleted' ORDER BY name"),
    pool.query("SELECT id, name, slug, status, project_type FROM web_hosting_projects WHERE status != 'deleted' ORDER BY name"),
  ]);

  return { repos: repoResult.rows, databases: dbResult.rows, hosting: hostingResult.rows };
}

// ─── Activity Feed ───────────────────────────────────────────

async function logActivity(pool, pipelineId, { eventType, resourceType, resourceName, environment, message, metadata }) {
  await pool.query(
    `INSERT INTO vpc_pipeline_activity (pipeline_id, event_type, resource_type, resource_name, environment, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [pipelineId, eventType, resourceType || null, resourceName || null, environment || null, message, JSON.stringify(metadata || {})]
  );
}

async function getActivity(pool, pipelineId, limit = 30) {
  const { rows } = await pool.query(
    'SELECT * FROM vpc_pipeline_activity WHERE pipeline_id = $1 ORDER BY created_at DESC LIMIT $2',
    [pipelineId, limit]
  );
  return rows;
}

// ─── Deploy Action ───────────────────────────────────────────

async function deployHosting(pool, pipelineId, hostingId, environment) {
  const webHostingService = require('./webHostingService');
  const project = await webHostingService.getProject(pool, hostingId);
  if (!project) throw new Error('Hosting project not found');

  await logActivity(pool, pipelineId, {
    eventType: 'deploy_start',
    resourceType: 'hosting',
    resourceName: project.name,
    environment,
    message: `Deploy started for ${project.name}`,
  });

  try {
    const result = await webHostingService.deploy(pool, project);
    webHostingService.refreshSlugCache(pool);
    webHostingService.refreshDomainCache(pool);

    await logActivity(pool, pipelineId, {
      eventType: 'deploy_success',
      resourceType: 'hosting',
      resourceName: project.name,
      environment,
      message: `${project.name} deployed successfully`,
    });

    return result;
  } catch (err) {
    await logActivity(pool, pipelineId, {
      eventType: 'deploy_error',
      resourceType: 'hosting',
      resourceName: project.name,
      environment,
      message: `Deploy failed: ${err.message}`,
      metadata: { error: err.message },
    });
    throw err;
  }
}

// ─── Fork to Beta (clones ALL resources) ─────────────────────

async function forkToBeta(pool, pipelineId) {
  const webHostingService = require('./webHostingService');
  const resolved = await getResolved(pool, pipelineId);
  if (!resolved) throw new Error('Pipeline not found');

  const results = { forkedDbs: [], forkedHosting: [], sharedRepos: [], errors: [] };

  // 1. Fork each production DB → beta DB (schema copy)
  for (const db of resolved.production.databases) {
    try {
      const forkName = `${db.name} (Beta)`;
      const forkSlug = `${db.slug}-beta`;
      const forked = await dbForkService.forkProject(pool, db.id, {
        name: forkName, slug: forkSlug, copyData: false, environment: 'beta',
      });
      await addResource(pool, pipelineId, { resourceType: 'db', resourceId: forked.id, environment: 'beta' });
      results.forkedDbs.push(forked);
      await logActivity(pool, pipelineId, {
        eventType: 'fork', resourceType: 'db', resourceName: forkName,
        environment: 'beta', message: `Forked DB: ${db.name} → ${forkName}`,
      });
    } catch (err) {
      results.errors.push({ resource: db.name, type: 'db', error: err.message });
    }
  }

  // 2. Clone each production hosting site → beta hosting site (separate deploy)
  for (const site of resolved.production.hosting) {
    try {
      const betaName = `${site.name} (Beta)`;
      const betaSlug = `${site.slug}-beta`;
      const cloned = await webHostingService.createProject(pool, {
        name: betaName,
        slug: betaSlug,
        projectType: site.project_type,
        gitUrl: site.git_url,
        gitToken: site.git_token,
        gitBranch: site.git_branch || 'main',
        buildCommand: site.build_command,
        installCommand: site.install_command,
        outputDir: site.output_dir,
        nodeEntryPoint: site.node_entry_point,
        envVars: site.env_vars || {},
        createdBy: site.created_by,
      });
      await addResource(pool, pipelineId, { resourceType: 'hosting', resourceId: cloned.id, environment: 'beta' });
      results.forkedHosting.push(cloned);
      await logActivity(pool, pipelineId, {
        eventType: 'fork', resourceType: 'hosting', resourceName: betaName,
        environment: 'beta', message: `Cloned hosting: ${site.name} → ${betaName}`,
      });
    } catch (err) {
      results.errors.push({ resource: site.name, type: 'hosting', error: err.message });
    }
  }

  // 3. Share repos between prod and beta (same repo, both environments)
  for (const repo of resolved.production.repos) {
    try {
      await addResource(pool, pipelineId, { resourceType: 'repo', resourceId: repo.id, environment: 'beta' });
      results.sharedRepos.push(repo);
    } catch {}
  }

  await logActivity(pool, pipelineId, {
    eventType: 'fork_complete', resourceType: null, resourceName: null,
    environment: 'beta',
    message: `Beta environment created: ${results.forkedDbs.length} DB(s), ${results.forkedHosting.length} site(s), ${results.sharedRepos.length} repo(s)`,
  });

  return results;
}

// ─── Promote Beta → Production ───────────────────────────────
// Pushes beta schema changes to prod DB + redeploys prod hosting

async function promoteToProd(pool, pipelineId) {
  const webHostingService = require('./webHostingService');
  const prService = require('./prService');
  const resolved = await getResolved(pool, pipelineId);
  if (!resolved) throw new Error('Pipeline not found');

  const results = { schemaPRs: [], deployedSites: [], errors: [] };

  // 1. Schema promote: for each prod/beta DB pair, generate diff and create PR
  if (resolved.production.databases.length > 0 && resolved.beta.databases.length > 0) {
    const prodDb = resolved.production.databases[0];
    const betaDb = resolved.beta.databases[0];

    try {
      const prodPool = dbService.getProjectPool(prodDb);
      const betaPool = dbService.getProjectPool(betaDb);
      const [prodSnap, betaSnap] = await Promise.all([
        syncService.getSchemaSnapshot(prodPool),
        syncService.getSchemaSnapshot(betaPool),
      ]);
      const diff = dbForkService.diffSchemas(prodSnap, betaSnap);
      const sql = dbForkService.generatePromoteSQL(diff);

      if (sql.trim()) {
        const pr = await prService.createPullRequest(pool, {
          projectId: prodDb.id,
          title: `Promote from ${betaDb.name}`,
          description: `Schema changes from beta.\nNew tables: ${diff.summary.newTables}, New columns: ${diff.summary.newColumns}`,
          sqlContent: sql,
          submittedBy: 'pipeline-promote',
        });
        results.schemaPRs.push({ pr, diff: diff.summary });
        await logActivity(pool, pipelineId, {
          eventType: 'promote_schema', resourceType: 'db', resourceName: prodDb.name,
          environment: 'production',
          message: `Schema PR #${pr.pr_number} created on ${prodDb.name}: ${diff.summary.newTables} tables, ${diff.summary.newColumns} columns`,
        });
      }
    } catch (err) {
      results.errors.push({ type: 'schema', error: err.message });
    }
  }

  // 2. Redeploy production hosting sites (pull latest code)
  for (const site of resolved.production.hosting) {
    try {
      await webHostingService.deploy(pool, site);
      webHostingService.refreshSlugCache(pool);
      webHostingService.refreshDomainCache(pool);
      results.deployedSites.push(site.name);
      await logActivity(pool, pipelineId, {
        eventType: 'promote_deploy', resourceType: 'hosting', resourceName: site.name,
        environment: 'production', message: `Redeployed ${site.name} to production`,
      });
    } catch (err) {
      results.errors.push({ type: 'deploy', resource: site.name, error: err.message });
    }
  }

  await logActivity(pool, pipelineId, {
    eventType: 'promote_complete', resourceType: null, resourceName: null,
    environment: 'production',
    message: `Promote complete: ${results.schemaPRs.length} schema PR(s), ${results.deployedSites.length} site(s) deployed`,
  });

  return results;
}

module.exports = {
  getAll, getById, create, update, remove,
  addResource, removeResource, setResources,
  getResolved, getAvailableResources,
  logActivity, getActivity, deployHosting, forkToBeta, promoteToProd,
};
