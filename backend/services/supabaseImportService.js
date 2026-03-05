const { Pool } = require('pg');
const crypto = require('crypto');
const banadbService = require('./banadbService');

// ── Encryption helpers (for storing connection strings) ────────────
const ALGO = 'aes-256-gcm';
const ENC_KEY = crypto.scryptSync(process.env.JWT_SECRET || 'bana-default-key', 'bana-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, ENC_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(data) {
  const [ivHex, tagHex, encrypted] = data.split(':');
  const decipher = crypto.createDecipheriv(ALGO, ENC_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Connection helpers ─────────────────────────────────────────────

function parseConnectionString(connStr) {
  try {
    const url = new URL(connStr);
    return {
      host: url.hostname,
      port: url.port || '5432',
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) || 'postgres',
    };
  } catch {
    throw new Error('Invalid connection string format');
  }
}

function createRemotePool(connectionString) {
  const conn = parseConnectionString(connectionString);
  return new Pool({
    host: conn.host,
    port: parseInt(conn.port),
    user: conn.user,
    password: conn.password,
    database: conn.database,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    statement_timeout: 300000, // 5 min per query
  });
}

// ── Test Connection ────────────────────────────────────────────────

async function testConnection(connectionString) {
  const remote = createRemotePool(connectionString);
  try {
    await remote.query('SELECT 1');

    const sizeResult = await remote.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
    );
    const tableResult = await remote.query(
      `SELECT count(*) AS cnt FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );

    let authUserCount = 0;
    try {
      const authResult = await remote.query('SELECT count(*) AS cnt FROM auth.users');
      authUserCount = parseInt(authResult.rows[0].cnt);
    } catch {}

    const schemasResult = await remote.query(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
       ORDER BY schema_name`
    );

    // Get table list with row counts for detail
    const tablesResult = await remote.query(
      `SELECT c.relname AS name,
              pg_stat_get_live_tuples(c.oid) AS row_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`
    );

    return {
      connected: true,
      database_size: sizeResult.rows[0].size,
      table_count: parseInt(tableResult.rows[0].cnt),
      auth_user_count: authUserCount,
      schemas: schemasResult.rows.map((r) => r.schema_name),
      tables: tablesResult.rows.map((r) => ({ name: r.name, rows: parseInt(r.row_count) })),
    };
  } finally {
    await remote.end();
  }
}

// ── Save / Get / Remove connection ─────────────────────────────────

async function saveConnection(mainPool, projectId, connectionString) {
  const encrypted = encrypt(connectionString);
  await mainPool.query(
    `UPDATE bana_projects SET supabase_connection = $1, updated_at = NOW() WHERE id = $2`,
    [encrypted, projectId]
  );
}

async function getConnection(mainPool, projectId) {
  const { rows } = await mainPool.query(
    `SELECT supabase_connection FROM bana_projects WHERE id = $1`,
    [projectId]
  );
  if (!rows[0]?.supabase_connection) return null;
  return decrypt(rows[0].supabase_connection);
}

async function removeConnection(mainPool, projectId) {
  await mainPool.query(
    `UPDATE bana_projects SET supabase_connection = NULL, last_sync_at = NULL, sync_status = NULL, updated_at = NOW() WHERE id = $1`,
    [projectId]
  );
}

// ── Direct SQL Import (full, table-by-table) ───────────────────────

async function importFromSupabase(mainPool, project, { connectionString, importAuth = true }) {
  const startTime = Date.now();
  const remote = createRemotePool(connectionString);
  const local = banadbService.getProjectPool(project);

  const result = {
    status: 'running',
    steps: [],
    tables_imported: 0,
    rows_imported: 0,
    auth_users_imported: 0,
    duration_ms: 0,
    message: '',
  };

  const addStep = (step, status, message) => {
    result.steps.push({ step, status, message });
  };

  try {
    // ── Step 1: Get all enums/custom types from remote ─────────
    addStep('types', 'running', 'Importing custom types & enums...');
    const enumsResult = await remote.query(`
      SELECT t.typname AS enum_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname
    `);

    for (const en of enumsResult.rows) {
      // array_agg may return a JS array or a PG string like "{val1,val2}"
      let labelArr = en.labels;
      if (typeof labelArr === 'string') {
        labelArr = labelArr.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      }
      if (!Array.isArray(labelArr)) labelArr = [];
      const labels = labelArr.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
      try {
        await local.query(`DROP TYPE IF EXISTS "${en.enum_name}" CASCADE`);
        if (labels) await local.query(`CREATE TYPE "${en.enum_name}" AS ENUM (${labels})`);
      } catch (e) {
        console.error(`[Import] Enum ${en.enum_name}:`, e.message);
      }
    }
    result.steps[result.steps.length - 1] = {
      step: 'types', status: 'done',
      message: `Imported ${enumsResult.rows.length} custom types`,
    };

    // ── Step 2: Get tables in dependency order ─────────────────
    addStep('schema', 'running', 'Importing table schemas...');

    // Get all public tables
    const tablesResult = await remote.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);
    const tableNames = tablesResult.rows.map((r) => r.table_name);

    // Get foreign key dependencies to determine order
    const depsResult = await remote.query(`
      SELECT DISTINCT
        tc.table_name AS child,
        ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name != ccu.table_name
    `);

    // Topological sort for correct creation order
    const ordered = topologicalSort(tableNames, depsResult.rows);

    // Drop ALL existing public tables in local DB (reverse order) for clean import
    for (const tbl of [...ordered].reverse()) {
      try {
        await local.query(`DROP TABLE IF EXISTS "public"."${tbl}" CASCADE`);
      } catch {}
    }

    // For each table: get full CREATE TABLE DDL and recreate locally
    let tablesCreated = 0;
    for (const tbl of ordered) {
      try {
        const ddl = await getTableDDL(remote, tbl);
        await local.query(ddl);
        tablesCreated++;
      } catch (e) {
        console.error(`[Import] Schema for ${tbl}:`, e.message);
        addStep(`schema_${tbl}`, 'warning', `Table "${tbl}" schema failed: ${e.message}`);
      }
    }

    result.steps[result.steps.length - 1] = {
      step: 'schema', status: 'done',
      message: `Created ${tablesCreated}/${tableNames.length} table schemas`,
    };

    // ── Step 3: Copy all data table by table ───────────────────
    addStep('data', 'running', 'Copying table data...');
    let totalRows = 0;

    for (const tbl of ordered) {
      try {
        const copied = await copyTableData(remote, local, tbl);
        totalRows += copied;
      } catch (e) {
        console.error(`[Import] Data for ${tbl}:`, e.message);
        addStep(`data_${tbl}`, 'warning', `Table "${tbl}" data copy failed: ${e.message}`);
      }
    }
    result.rows_imported = totalRows;
    result.steps[result.steps.length - 1] = {
      step: 'data', status: 'done',
      message: `Copied ${totalRows.toLocaleString()} rows across ${tablesCreated} tables`,
    };

    // ── Step 4: Create indexes, foreign keys, constraints ──────
    addStep('constraints', 'running', 'Creating indexes & foreign keys...');
    let constraintCount = 0;

    // Foreign keys
    const fkResult = await remote.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.update_rule,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);

    for (const fk of fkResult.rows) {
      try {
        const onUpdate = fk.update_rule !== 'NO ACTION' ? ` ON UPDATE ${fk.update_rule}` : '';
        const onDelete = fk.delete_rule !== 'NO ACTION' ? ` ON DELETE ${fk.delete_rule}` : '';
        await local.query(`
          ALTER TABLE "public"."${fk.table_name}"
          ADD CONSTRAINT "${fk.constraint_name}"
          FOREIGN KEY ("${fk.column_name}")
          REFERENCES "public"."${fk.foreign_table_name}" ("${fk.foreign_column_name}")
          ${onUpdate}${onDelete}
        `);
        constraintCount++;
      } catch (e) {
        // Might already exist or conflict - skip
        console.error(`[Import] FK ${fk.constraint_name}:`, e.message);
      }
    }

    // Indexes (non-primary, non-unique-constraint)
    const idxResult = await remote.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT IN (
          SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_schema = 'public'
        )
    `);

    for (const idx of idxResult.rows) {
      try {
        // Replace CREATE INDEX with CREATE INDEX IF NOT EXISTS
        const safeIdx = idx.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
                                    .replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS');
        await local.query(safeIdx);
        constraintCount++;
      } catch (e) {
        console.error(`[Import] Index:`, e.message);
      }
    }

    result.steps[result.steps.length - 1] = {
      step: 'constraints', status: 'done',
      message: `Created ${constraintCount} foreign keys & indexes`,
    };

    // ── Step 5: Fix sequences ──────────────────────────────────
    addStep('sequences', 'running', 'Syncing sequences...');
    let seqCount = 0;
    try {
      const seqResult = await remote.query(`
        SELECT
          s.relname AS seq_name,
          t.relname AS table_name,
          a.attname AS column_name,
          pg_catalog.format('%s.%s', n.nspname, s.relname) AS qualified
        FROM pg_class s
        JOIN pg_namespace n ON n.oid = s.relnamespace
        JOIN pg_depend d ON d.objid = s.oid
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S' AND n.nspname = 'public'
      `);

      for (const seq of seqResult.rows) {
        try {
          // Get current value from remote
          const valResult = await remote.query(`SELECT last_value FROM "public"."${seq.seq_name}"`);
          const lastVal = valResult.rows[0]?.last_value || 1;

          // Create sequence if not exists and set value
          await local.query(`
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = '${seq.seq_name}' AND relkind = 'S') THEN
                CREATE SEQUENCE "public"."${seq.seq_name}";
              END IF;
            END $$
          `);
          await local.query(`SELECT setval('"public"."${seq.seq_name}"', ${lastVal}, true)`);

          // Link to column
          await local.query(`
            ALTER TABLE "public"."${seq.table_name}"
            ALTER COLUMN "${seq.column_name}"
            SET DEFAULT nextval('"public"."${seq.seq_name}"')
          `);
          seqCount++;
        } catch (e) {
          console.error(`[Import] Sequence ${seq.seq_name}:`, e.message);
        }
      }
    } catch (e) {
      console.error(`[Import] Sequences query:`, e.message);
    }

    result.steps[result.steps.length - 1] = {
      step: 'sequences', status: 'done',
      message: `Synced ${seqCount} sequences`,
    };

    // ── Step 6: Import auth users ──────────────────────────────
    if (importAuth) {
      addStep('auth', 'running', 'Migrating auth users...');
      try {
        const authResult = await importAuthUsers(remote, local);
        result.auth_users_imported = authResult.imported;
        result.steps[result.steps.length - 1] = {
          step: 'auth', status: 'done',
          message: `Imported ${authResult.imported}/${authResult.total} auth users`,
        };
      } catch (e) {
        result.steps[result.steps.length - 1] = {
          step: 'auth', status: 'warning',
          message: `Auth import skipped: ${e.message}`,
        };
      }
    }

    // ── Save connection for future sync ────────────────────────
    await saveConnection(mainPool, project.id, connectionString);
    await mainPool.query(
      `UPDATE bana_projects SET last_sync_at = NOW(), sync_status = 'synced', updated_at = NOW() WHERE id = $1`,
      [project.id]
    );

    result.tables_imported = tablesCreated;
    result.status = 'completed';
    result.message = `Import complete! ${tablesCreated} tables, ${totalRows.toLocaleString()} rows, ${result.auth_users_imported} auth users`;

  } catch (err) {
    result.status = 'failed';
    result.message = err.message;
    result.steps.push({ step: 'error', status: 'failed', message: err.message });
  } finally {
    await remote.end();
    result.duration_ms = Date.now() - startTime;
  }

  return result;
}

// ── Sync (incremental update) ──────────────────────────────────────

async function syncFromSupabase(mainPool, project) {
  const connectionString = await getConnection(mainPool, project.id);
  if (!connectionString) throw new Error('No Supabase connection linked. Import first.');

  const startTime = Date.now();
  const remote = createRemotePool(connectionString);
  const local = banadbService.getProjectPool(project);

  const result = {
    status: 'running',
    steps: [],
    new_tables: 0,
    rows_synced: 0,
    auth_users_synced: 0,
    duration_ms: 0,
    message: '',
  };

  const addStep = (step, status, message) => {
    result.steps.push({ step, status, message });
  };

  try {
    await mainPool.query(
      `UPDATE bana_projects SET sync_status = 'syncing', updated_at = NOW() WHERE id = $1`,
      [project.id]
    );

    // ── 1: Discover new/changed enums ──────────────────────────
    addStep('types', 'running', 'Syncing custom types...');
    const enumsResult = await remote.query(`
      SELECT t.typname AS enum_name,
             array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname
    `);
    for (const en of enumsResult.rows) {
      let labelArr = en.labels;
      if (typeof labelArr === 'string') {
        labelArr = labelArr.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      }
      if (!Array.isArray(labelArr)) labelArr = [];
      const labels = labelArr.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
      try {
        await local.query(`DROP TYPE IF EXISTS "${en.enum_name}" CASCADE`);
        if (labels) await local.query(`CREATE TYPE "${en.enum_name}" AS ENUM (${labels})`);
      } catch (e) {
        console.error(`[Sync] Enum ${en.enum_name}:`, e.message);
      }
    }
    result.steps[result.steps.length - 1] = {
      step: 'types', status: 'done',
      message: `Synced ${enumsResult.rows.length} types`,
    };

    // ── 2: Compare table lists ─────────────────────────────────
    addStep('tables', 'running', 'Comparing table structures...');

    const remoteTablesResult = await remote.query(`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname
    `);
    const remoteTables = remoteTablesResult.rows.map((r) => r.table_name);

    const localTablesResult = await local.query(`
      SELECT c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname
    `);
    const localTables = new Set(localTablesResult.rows.map((r) => r.table_name));

    // Get dependency order
    const depsResult = await remote.query(`
      SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        AND tc.table_name != ccu.table_name
    `);
    const ordered = topologicalSort(remoteTables, depsResult.rows);

    // New tables that don't exist locally
    const newTables = ordered.filter((t) => !localTables.has(t));
    const existingTables = ordered.filter((t) => localTables.has(t));

    // Create new tables
    for (const tbl of newTables) {
      try {
        const ddl = await getTableDDL(remote, tbl);
        await local.query(ddl);
        result.new_tables++;
      } catch (e) {
        addStep(`new_${tbl}`, 'warning', `New table "${tbl}" failed: ${e.message}`);
      }
    }

    // Sync columns on existing tables (add missing columns)
    for (const tbl of existingTables) {
      try {
        await syncTableColumns(remote, local, tbl);
      } catch (e) {
        console.error(`[Sync] Columns ${tbl}:`, e.message);
      }
    }

    result.steps[result.steps.length - 1] = {
      step: 'tables', status: 'done',
      message: `${newTables.length} new tables, ${existingTables.length} existing tables synced`,
    };

    // ── 3: Sync data for all tables ────────────────────────────
    addStep('data', 'running', 'Syncing table data...');
    let totalRows = 0;

    for (const tbl of ordered) {
      try {
        const synced = await syncTableData(remote, local, tbl);
        totalRows += synced;
      } catch (e) {
        console.error(`[Sync] Data ${tbl}:`, e.message);
        addStep(`data_${tbl}`, 'warning', `"${tbl}" data sync failed: ${e.message}`);
      }
    }
    result.rows_synced = totalRows;
    result.steps[result.steps.length - 1] = {
      step: 'data', status: 'done',
      message: `Synced ${totalRows.toLocaleString()} rows across ${ordered.length} tables`,
    };

    // ── 4: Sync foreign keys & indexes ─────────────────────────
    addStep('constraints', 'running', 'Syncing constraints...');
    let constraintCount = 0;
    const fkResult = await remote.query(`
      SELECT tc.constraint_name, tc.table_name, kcu.column_name,
             ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name,
             rc.update_rule, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    for (const fk of fkResult.rows) {
      try {
        const onUpdate = fk.update_rule !== 'NO ACTION' ? ` ON UPDATE ${fk.update_rule}` : '';
        const onDelete = fk.delete_rule !== 'NO ACTION' ? ` ON DELETE ${fk.delete_rule}` : '';
        await local.query(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = '${fk.constraint_name}' AND table_schema = 'public') THEN
              ALTER TABLE "public"."${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}"
              FOREIGN KEY ("${fk.column_name}") REFERENCES "public"."${fk.foreign_table_name}" ("${fk.foreign_column_name}")${onUpdate}${onDelete};
            END IF;
          END $$
        `);
        constraintCount++;
      } catch {}
    }

    const idxResult = await remote.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname NOT IN (SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public')
    `);
    for (const idx of idxResult.rows) {
      try {
        const safeIdx = idx.indexdef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
                                    .replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS');
        await local.query(safeIdx);
        constraintCount++;
      } catch {}
    }
    result.steps[result.steps.length - 1] = {
      step: 'constraints', status: 'done',
      message: `Synced ${constraintCount} constraints & indexes`,
    };

    // ── 5: Sync sequences ──────────────────────────────────────
    addStep('sequences', 'running', 'Syncing sequences...');
    let seqCount = 0;
    try {
      const seqResult = await remote.query(`
        SELECT s.relname AS seq_name, t.relname AS table_name, a.attname AS column_name
        FROM pg_class s
        JOIN pg_namespace n ON n.oid = s.relnamespace
        JOIN pg_depend d ON d.objid = s.oid
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S' AND n.nspname = 'public'
      `);
      for (const seq of seqResult.rows) {
        try {
          const valResult = await remote.query(`SELECT last_value FROM "public"."${seq.seq_name}"`);
          const lastVal = valResult.rows[0]?.last_value || 1;
          await local.query(`
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = '${seq.seq_name}' AND relkind = 'S') THEN
                CREATE SEQUENCE "public"."${seq.seq_name}";
              END IF;
            END $$
          `);
          await local.query(`SELECT setval('"public"."${seq.seq_name}"', ${lastVal}, true)`);
          await local.query(`ALTER TABLE "public"."${seq.table_name}" ALTER COLUMN "${seq.column_name}" SET DEFAULT nextval('"public"."${seq.seq_name}"')`);
          seqCount++;
        } catch {}
      }
    } catch {}
    result.steps[result.steps.length - 1] = {
      step: 'sequences', status: 'done',
      message: `Synced ${seqCount} sequences`,
    };

    // ── 6: Sync auth users ─────────────────────────────────────
    addStep('auth', 'running', 'Syncing auth users...');
    try {
      const authResult = await importAuthUsers(remote, local);
      result.auth_users_synced = authResult.imported;
      result.steps[result.steps.length - 1] = {
        step: 'auth', status: 'done',
        message: `Synced ${authResult.imported} auth users`,
      };
    } catch (e) {
      result.steps[result.steps.length - 1] = {
        step: 'auth', status: 'warning',
        message: `Auth sync skipped: ${e.message}`,
      };
    }

    await mainPool.query(
      `UPDATE bana_projects SET last_sync_at = NOW(), sync_status = 'synced', updated_at = NOW() WHERE id = $1`,
      [project.id]
    );

    result.status = 'completed';
    result.message = `Sync complete! ${result.new_tables} new tables, ${totalRows.toLocaleString()} rows synced`;

  } catch (err) {
    result.status = 'failed';
    result.message = err.message;
    result.steps.push({ step: 'error', status: 'failed', message: err.message });
    await mainPool.query(
      `UPDATE bana_projects SET sync_status = 'error', updated_at = NOW() WHERE id = $1`,
      [project.id]
    );
  } finally {
    await remote.end();
    result.duration_ms = Date.now() - startTime;
  }

  return result;
}

// ── Helper: Generate CREATE TABLE DDL from remote ──────────────────

async function getTableDDL(remote, tableName) {
  const colResult = await remote.query(`
    SELECT
      c.column_name,
      c.data_type,
      c.udt_name,
      c.character_maximum_length,
      c.numeric_precision,
      c.numeric_scale,
      c.is_nullable,
      c.column_default,
      c.is_identity,
      c.identity_generation
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position
  `, [tableName]);

  if (colResult.rows.length === 0) throw new Error(`Table ${tableName} has no columns`);

  const columns = colResult.rows.map((col) => {
    let type = getColumnType(col);
    let nullable = col.is_nullable === 'NO' ? ' NOT NULL' : '';
    let defaultVal = '';

    if (col.is_identity === 'YES') {
      type = col.data_type === 'bigint' ? 'BIGINT' : 'INTEGER';
      defaultVal = '';
      // Use GENERATED ALWAYS / BY DEFAULT
      const genType = col.identity_generation === 'ALWAYS' ? 'ALWAYS' : 'BY DEFAULT';
      return `  "${col.column_name}" ${type} GENERATED ${genType} AS IDENTITY${nullable}`;
    }

    if (col.column_default) {
      // Skip defaults that reference sequences (we handle sequences separately)
      // But keep other defaults like gen_random_uuid(), NOW(), literal values
      const def = col.column_default;
      if (!def.includes('nextval(')) {
        defaultVal = ` DEFAULT ${def}`;
      }
    }

    return `  "${col.column_name}" ${type}${defaultVal}${nullable}`;
  });

  // Get primary key
  const pkResult = await remote.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = $1
    ORDER BY kcu.ordinal_position
  `, [tableName]);

  let pkLine = '';
  if (pkResult.rows.length > 0) {
    const pkCols = pkResult.rows.map((r) => `"${r.column_name}"`).join(', ');
    pkLine = `,\n  PRIMARY KEY (${pkCols})`;
  }

  // Get unique constraints (not PK)
  const uniqueResult = await remote.query(`
    SELECT tc.constraint_name,
           array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS cols
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public' AND tc.table_name = $1
    GROUP BY tc.constraint_name
  `, [tableName]);

  let uniqueLines = '';
  for (const uq of uniqueResult.rows) {
    const cols = uq.cols.map((c) => `"${c}"`).join(', ');
    uniqueLines += `,\n  CONSTRAINT "${uq.constraint_name}" UNIQUE (${cols})`;
  }

  // Get check constraints
  const checkResult = await remote.query(`
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND rel.relname = $1 AND con.contype = 'c'
  `, [tableName]);

  let checkLines = '';
  for (const ck of checkResult.rows) {
    checkLines += `,\n  CONSTRAINT "${ck.conname}" ${ck.def}`;
  }

  return `CREATE TABLE IF NOT EXISTS "public"."${tableName}" (\n${columns.join(',\n')}${pkLine}${uniqueLines}${checkLines}\n)`;
}

function getColumnType(col) {
  const { data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale } = col;

  // Handle user-defined types (enums)
  if (data_type === 'USER-DEFINED') return `"${udt_name}"`;

  // Array types
  if (data_type === 'ARRAY') return `${udt_name.replace(/^_/, '')}[]`;

  // Common type mappings
  const typeMap = {
    'character varying': character_maximum_length ? `VARCHAR(${character_maximum_length})` : 'TEXT',
    'character': `CHAR(${character_maximum_length || 1})`,
    'integer': 'INTEGER',
    'bigint': 'BIGINT',
    'smallint': 'SMALLINT',
    'boolean': 'BOOLEAN',
    'text': 'TEXT',
    'uuid': 'UUID',
    'jsonb': 'JSONB',
    'json': 'JSON',
    'timestamp with time zone': 'TIMESTAMPTZ',
    'timestamp without time zone': 'TIMESTAMP',
    'date': 'DATE',
    'time with time zone': 'TIMETZ',
    'time without time zone': 'TIME',
    'double precision': 'DOUBLE PRECISION',
    'real': 'REAL',
    'numeric': numeric_precision ? `NUMERIC(${numeric_precision},${numeric_scale || 0})` : 'NUMERIC',
    'bytea': 'BYTEA',
    'inet': 'INET',
    'cidr': 'CIDR',
    'macaddr': 'MACADDR',
    'interval': 'INTERVAL',
    'point': 'POINT',
    'line': 'LINE',
    'box': 'BOX',
    'tsvector': 'TSVECTOR',
    'tsquery': 'TSQUERY',
    'oid': 'OID',
  };

  return typeMap[data_type] || data_type.toUpperCase();
}

// ── Helper: Copy all data from one table ───────────────────────────

async function copyTableData(remote, local, tableName) {
  // Get column names
  const colResult = await remote.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  const columns = colResult.rows.map((r) => `"${r.column_name}"`);

  if (columns.length === 0) return 0;

  // Count rows
  const countResult = await remote.query(`SELECT count(*) AS cnt FROM "public"."${tableName}"`);
  const totalRows = parseInt(countResult.rows[0].cnt);
  if (totalRows === 0) return 0;

  // Disable triggers during data load for speed
  try {
    await local.query(`ALTER TABLE "public"."${tableName}" DISABLE TRIGGER ALL`);
  } catch {}

  // Batch copy: fetch in chunks of 5000 rows
  const BATCH = 5000;
  let copied = 0;

  for (let offset = 0; offset < totalRows; offset += BATCH) {
    const { rows } = await remote.query(
      `SELECT ${columns.join(', ')} FROM "public"."${tableName}" LIMIT ${BATCH} OFFSET ${offset}`
    );

    if (rows.length === 0) break;

    // Build multi-row INSERT
    const valueSets = [];
    const params = [];
    let paramIdx = 1;

    for (const row of rows) {
      const placeholders = columns.map(() => `$${paramIdx++}`);
      valueSets.push(`(${placeholders.join(', ')})`);
      for (const col of colResult.rows) {
        params.push(row[col.column_name]);
      }
    }

    try {
      await local.query(
        `INSERT INTO "public"."${tableName}" (${columns.join(', ')}) VALUES ${valueSets.join(', ')}`,
        params
      );
      copied += rows.length;
    } catch (e) {
      // If batch insert fails, try row by row
      for (const row of rows) {
        try {
          const vals = colResult.rows.map((c) => row[c.column_name]);
          const placeholders = vals.map((_, i) => `$${i + 1}`);
          await local.query(
            `INSERT INTO "public"."${tableName}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
            vals
          );
          copied++;
        } catch (rowErr) {
          console.error(`[Import] Row in ${tableName}:`, rowErr.message);
        }
      }
    }
  }

  // Re-enable triggers
  try {
    await local.query(`ALTER TABLE "public"."${tableName}" ENABLE TRIGGER ALL`);
  } catch {}

  return copied;
}

// ── Helper: Sync data using UPSERT (for sync mode) ────────────────

async function syncTableData(remote, local, tableName) {
  const colResult = await remote.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  const columns = colResult.rows.map((r) => `"${r.column_name}"`);
  if (columns.length === 0) return 0;

  // Get primary key columns
  const pkResult = await remote.query(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = $1
  `, [tableName]);
  const pkColumns = pkResult.rows.map((r) => `"${r.column_name}"`);

  // If no PK, do a full replace (truncate + insert)
  if (pkColumns.length === 0) {
    try { await local.query(`TRUNCATE TABLE "public"."${tableName}" CASCADE`); } catch {}
    return await copyTableData(remote, local, tableName);
  }

  // Disable triggers during sync
  try {
    await local.query(`ALTER TABLE "public"."${tableName}" DISABLE TRIGGER ALL`);
  } catch {}

  // UPSERT approach: fetch all from remote, upsert into local
  const countResult = await remote.query(`SELECT count(*) AS cnt FROM "public"."${tableName}"`);
  const totalRows = parseInt(countResult.rows[0].cnt);
  if (totalRows === 0) return 0;

  const BATCH = 2000;
  let synced = 0;

  // Build the ON CONFLICT update clause
  const nonPkCols = columns.filter((c) => !pkColumns.includes(c));
  const updateClause = nonPkCols.length > 0
    ? `DO UPDATE SET ${nonPkCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';

  for (let offset = 0; offset < totalRows; offset += BATCH) {
    const { rows } = await remote.query(
      `SELECT ${columns.join(', ')} FROM "public"."${tableName}" LIMIT ${BATCH} OFFSET ${offset}`
    );
    if (rows.length === 0) break;

    // Row by row upsert (safer for mixed data)
    for (const row of rows) {
      try {
        const vals = colResult.rows.map((c) => row[c.column_name]);
        const placeholders = vals.map((_, i) => `$${i + 1}`);
        await local.query(
          `INSERT INTO "public"."${tableName}" (${columns.join(', ')})
           VALUES (${placeholders.join(', ')})
           ON CONFLICT (${pkColumns.join(', ')}) ${updateClause}`,
          vals
        );
        synced++;
      } catch (e) {
        console.error(`[Sync] Row in ${tableName}:`, e.message);
      }
    }
  }

  // Also delete rows that exist locally but not remotely
  try {
    const remotePks = await remote.query(
      `SELECT ${pkColumns.join(', ')} FROM "public"."${tableName}"`
    );
    const localPks = await local.query(
      `SELECT ${pkColumns.join(', ')} FROM "public"."${tableName}"`
    );

    if (pkColumns.length === 1) {
      const pkCol = pkResult.rows[0].column_name;
      const remoteIds = new Set(remotePks.rows.map((r) => String(r[pkCol])));
      const toDelete = localPks.rows
        .filter((r) => !remoteIds.has(String(r[pkCol])))
        .map((r) => r[pkCol]);

      if (toDelete.length > 0) {
        // Delete in batches
        for (let i = 0; i < toDelete.length; i += 500) {
          const batch = toDelete.slice(i, i + 500);
          const placeholders = batch.map((_, idx) => `$${idx + 1}`);
          await local.query(
            `DELETE FROM "public"."${tableName}" WHERE "${pkCol}" IN (${placeholders.join(', ')})`,
            batch
          );
        }
      }
    }
  } catch (e) {
    console.error(`[Sync] Delete stale rows ${tableName}:`, e.message);
  }

  // Re-enable triggers
  try {
    await local.query(`ALTER TABLE "public"."${tableName}" ENABLE TRIGGER ALL`);
  } catch {}

  return synced;
}

// ── Helper: Sync table columns (add missing ones) ──────────────────

async function syncTableColumns(remote, local, tableName) {
  const remoteCols = await remote.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length,
           numeric_precision, numeric_scale, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);

  const localCols = await local.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
  `, [tableName]);
  const localColSet = new Set(localCols.rows.map((r) => r.column_name));

  for (const col of remoteCols.rows) {
    if (!localColSet.has(col.column_name)) {
      const type = getColumnType(col);
      const nullable = col.is_nullable === 'NO' ? ' NOT NULL' : '';
      const defaultVal = col.column_default && !col.column_default.includes('nextval(')
        ? ` DEFAULT ${col.column_default}` : '';
      try {
        await local.query(
          `ALTER TABLE "public"."${tableName}" ADD COLUMN "${col.column_name}" ${type}${defaultVal}${nullable}`
        );
      } catch (e) {
        console.error(`[Sync] Add column ${tableName}.${col.column_name}:`, e.message);
      }
    }
  }
}

// ── Helper: Import auth users ──────────────────────────────────────

async function importAuthUsers(remote, local) {
  let authUsers;
  try {
    const result = await remote.query(
      `SELECT id, email, encrypted_password, raw_user_meta_data,
              email_confirmed_at, banned_until, created_at, updated_at
       FROM auth.users ORDER BY created_at`
    );
    authUsers = result.rows;
  } catch {
    throw new Error('Cannot access auth.users (may need direct DB connection, not pooler)');
  }

  if (authUsers.length === 0) return { imported: 0, total: 0 };

  // Ensure auth_users table exists
  await local.query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      metadata JSONB DEFAULT '{}',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  let imported = 0;
  for (const user of authUsers) {
    try {
      const isActive = !user.banned_until || new Date(user.banned_until) < new Date();
      const metadata = {
        imported_from: 'supabase',
        confirmed: !!user.email_confirmed_at,
        original_id: user.id,
        ...(user.raw_user_meta_data || {}),
      };

      await local.query(
        `INSERT INTO auth_users (id, email, password_hash, is_active, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           is_active = EXCLUDED.is_active,
           metadata = EXCLUDED.metadata,
           updated_at = EXCLUDED.updated_at`,
        [user.id, user.email, user.encrypted_password, isActive,
         JSON.stringify(metadata), user.created_at, user.updated_at || new Date()]
      );
      imported++;
    } catch (e) {
      console.error(`[Import] Auth user ${user.email}:`, e.message);
    }
  }

  return { imported, total: authUsers.length };
}

// ── Helper: Topological sort for table dependencies ────────────────

function topologicalSort(tables, dependencies) {
  const graph = new Map();
  const inDegree = new Map();

  for (const t of tables) {
    graph.set(t, []);
    inDegree.set(t, 0);
  }

  for (const { child, parent } of dependencies) {
    if (graph.has(parent) && graph.has(child)) {
      graph.get(parent).push(child);
      inDegree.set(child, (inDegree.get(child) || 0) + 1);
    }
  }

  const queue = [];
  for (const [t, deg] of inDegree) {
    if (deg === 0) queue.push(t);
  }

  const sorted = [];
  while (queue.length > 0) {
    const t = queue.shift();
    sorted.push(t);
    for (const dep of graph.get(t) || []) {
      inDegree.set(dep, inDegree.get(dep) - 1);
      if (inDegree.get(dep) === 0) queue.push(dep);
    }
  }

  // Add any remaining tables (circular deps)
  for (const t of tables) {
    if (!sorted.includes(t)) sorted.push(t);
  }

  return sorted;
}

module.exports = {
  testConnection,
  importFromSupabase,
  syncFromSupabase,
  saveConnection,
  getConnection,
  removeConnection,
  parseConnectionString,
};
