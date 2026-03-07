const { Pool } = require('pg');

// SQL to install DDL tracking in a project database
const TRACKING_SETUP_SQL = `
-- Schema change tracking table
CREATE TABLE IF NOT EXISTS _vpc_schema_changes (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_type TEXT,
  object_identity TEXT,
  ddl_command TEXT NOT NULL,
  schema_name TEXT DEFAULT 'public',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpc_schema_changes_id ON _vpc_schema_changes(id);

-- Event trigger function for CREATE/ALTER
CREATE OR REPLACE FUNCTION _vpc_capture_ddl() RETURNS event_trigger AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF r.object_identity LIKE '%_vpc_schema_changes%' OR r.object_identity LIKE '%_vpc_capture%' THEN
      CONTINUE;
    END IF;
    IF r.object_identity LIKE '%auth_users%' THEN
      CONTINUE;
    END IF;

    INSERT INTO _vpc_schema_changes (event_type, object_type, object_identity, ddl_command, schema_name)
    VALUES (
      TG_TAG,
      r.object_type,
      r.object_identity,
      current_query(),
      r.schema_name
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Event trigger function for DROP
CREATE OR REPLACE FUNCTION _vpc_capture_drop() RETURNS event_trigger AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF r.object_identity LIKE '%_vpc_schema_changes%' OR r.object_identity LIKE '%_vpc_capture%' THEN
      CONTINUE;
    END IF;

    INSERT INTO _vpc_schema_changes (event_type, object_type, object_identity, ddl_command, schema_name)
    VALUES (
      'DROP',
      r.object_type,
      r.object_identity,
      current_query(),
      r.schema_name
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Install event triggers
DROP EVENT TRIGGER IF EXISTS _vpc_ddl_trigger;
CREATE EVENT TRIGGER _vpc_ddl_trigger ON ddl_command_end
  EXECUTE FUNCTION _vpc_capture_ddl();

DROP EVENT TRIGGER IF EXISTS _vpc_drop_trigger;
CREATE EVENT TRIGGER _vpc_drop_trigger ON sql_drop
  EXECUTE FUNCTION _vpc_capture_drop();
`;

const TRACKING_TEARDOWN_SQL = `
DROP EVENT TRIGGER IF EXISTS _vpc_ddl_trigger;
DROP EVENT TRIGGER IF EXISTS _vpc_drop_trigger;
DROP FUNCTION IF EXISTS _vpc_capture_ddl();
DROP FUNCTION IF EXISTS _vpc_capture_drop();
DROP TABLE IF EXISTS _vpc_schema_changes;
`;

/**
 * Connect to a project DB using VPC admin credentials (needed for event trigger privileges).
 */
function getAdminProjectPool(project) {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: project.db_name,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

/**
 * Install DDL tracking (event triggers + _vpc_schema_changes table) in a project DB.
 */
async function installPullTracking(mainPool, project) {
  const adminPool = getAdminProjectPool(project);
  try {
    await adminPool.query(TRACKING_SETUP_SQL);
    if (mainPool) {
      await mainPool.query(
        `UPDATE bana_projects SET pull_tracking_enabled = true, pull_tracking_installed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [project.id]
      );
    }
    return { enabled: true };
  } finally {
    await adminPool.end();
  }
}

/**
 * Remove DDL tracking from a project DB.
 */
async function uninstallPullTracking(mainPool, project) {
  const adminPool = getAdminProjectPool(project);
  try {
    await adminPool.query(TRACKING_TEARDOWN_SQL);
    await mainPool.query(
      `UPDATE bana_projects SET pull_tracking_enabled = false, updated_at = NOW() WHERE id = $1`,
      [project.id]
    );
    return { disabled: true };
  } finally {
    await adminPool.end();
  }
}

/**
 * Get pull tracking status for a project.
 */
async function getPullTrackingStatus(mainPool, project) {
  const status = {
    enabled: project.pull_tracking_enabled || false,
    installed_at: project.pull_tracking_installed_at || null,
    total_changes: 0,
  };

  if (status.enabled) {
    try {
      const banadbService = require('./banadbService');
      const projectPool = banadbService.getProjectPool(project);
      const { rows } = await projectPool.query(
        `SELECT COUNT(*)::int AS count FROM _vpc_schema_changes`
      );
      status.total_changes = rows[0]?.count || 0;
    } catch {
      // Table may not exist yet
    }
  }

  return status;
}

/**
 * Get schema changes since a given ID.
 */
async function getSchemaChanges(projectPool, sinceId = 0, limit = 1000) {
  const { rows } = await projectPool.query(
    `SELECT id, event_type, object_type, object_identity, ddl_command, schema_name, created_at
     FROM _vpc_schema_changes
     WHERE id > $1
     ORDER BY id ASC
     LIMIT $2`,
    [sinceId, limit]
  );

  const latestId = rows.length > 0 ? rows[rows.length - 1].id : sinceId;
  return { changes: rows, latest_id: latestId, has_more: rows.length === limit };
}

/**
 * Get total change count from a project DB.
 */
async function getTotalChangeCount(projectPool) {
  try {
    const { rows } = await projectPool.query(
      `SELECT COUNT(*)::int AS count FROM _vpc_schema_changes`
    );
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Get the pull cursor for a specific API key.
 */
async function getPullCursor(mainPool, apiKeyId) {
  const { rows } = await mainPool.query(
    `SELECT last_change_id, last_pulled_at FROM bana_pull_cursors WHERE api_key_id = $1`,
    [apiKeyId]
  );
  return rows[0] || null;
}

/**
 * Update (or insert) the pull cursor for an API key.
 */
async function updatePullCursor(mainPool, apiKeyId, projectId, changeId) {
  await mainPool.query(
    `INSERT INTO bana_pull_cursors (api_key_id, project_id, last_change_id, last_pulled_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (api_key_id) DO UPDATE SET last_change_id = $3, last_pulled_at = NOW(), updated_at = NOW()`,
    [apiKeyId, projectId, changeId]
  );
}

/**
 * Format schema changes into a migration SQL file.
 */
function generateMigrationFile(changes, sequenceNumber) {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const filename = `${String(sequenceNumber).padStart(4, '0')}_vpc_pull_${timestamp}.sql`;

  const header = `-- VPC Pull Migration\n-- Generated: ${new Date().toISOString()}\n-- Changes: ${changes.length}\n\n`;
  const body = changes
    .map((c) => {
      const comment = `-- ${c.event_type} ${c.object_type}: ${c.object_identity} (${new Date(c.created_at).toISOString()})`;
      // Ensure DDL command ends with semicolon
      const cmd = c.ddl_command.trim().replace(/;*$/, ';');
      return `${comment}\n${cmd}`;
    })
    .join('\n\n');

  return { filename, content: header + body + '\n' };
}

module.exports = {
  installPullTracking,
  uninstallPullTracking,
  getPullTrackingStatus,
  getSchemaChanges,
  getTotalChangeCount,
  getPullCursor,
  updatePullCursor,
  generateMigrationFile,
};
