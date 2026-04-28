const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dbService = require('./dbService');
const pullService = require('./pullService');
const syncService = require('./syncService');

const TEMP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');

// ─── Fork a project database ────────────────────────────────────────

async function forkProject(pool, sourceProjectId, { name, slug, copyData = true, environment = 'beta' }) {
  const source = await dbService.getProject(pool, sourceProjectId);
  if (!source) throw new Error('Source project not found');
  if (source.status !== 'active') throw new Error('Source project is not active');

  // Generate credentials for the new project
  const dbName = dbService.generateDbName(slug);
  const dbUser = dbService.generateDbUser(slug);
  const dbPassword = dbService.generateDbPassword();

  const escapedUser = dbUser.replace(/"/g, '""');
  const escapedDb = dbName.replace(/"/g, '""');
  const escapedPassword = dbPassword.replace(/'/g, "''");

  const client = await pool.connect();
  let forkProject = null;

  try {
    // Create PostgreSQL user
    await client.query(
      `CREATE USER "${escapedUser}" WITH PASSWORD '${escapedPassword}' CONNECTION LIMIT ${source.max_connections || 10}`
    );

    // Create empty database owned by the new user
    await client.query(`CREATE DATABASE "${escapedDb}" OWNER "${escapedUser}"`);

    // Record in db_projects
    const { rows } = await client.query(
      `INSERT INTO db_projects (name, slug, db_name, db_user, db_password, storage_limit_mb, max_connections, forked_from, environment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, slug, dbName, dbUser, dbPassword, source.storage_limit_mb, source.max_connections, sourceProjectId, environment, source.created_by]
    );
    forkProject = rows[0];

    // Copy schema (and optionally data) from source using pg_dump/pg_restore
    await copyDatabase(source.db_name, dbName, copyData);

    // Install DDL tracking on the fork
    try {
      await pullService.installPullTracking(pool, forkProject);
      await client.query(
        `UPDATE db_projects SET pull_tracking_enabled = true, pull_tracking_installed_at = NOW() WHERE id = $1`,
        [forkProject.id]
      );
      forkProject.pull_tracking_enabled = true;
    } catch (trackingErr) {
      console.warn('[Fork] DDL tracking install warning:', trackingErr.message);
    }

    return forkProject;
  } catch (err) {
    // Cleanup on failure
    try { await client.query(`DROP DATABASE IF EXISTS "${escapedDb}"`); } catch {}
    try { await client.query(`DROP USER IF EXISTS "${escapedUser}"`); } catch {}
    if (forkProject) {
      try { await client.query(`DELETE FROM db_projects WHERE id = $1`, [forkProject.id]); } catch {}
    }
    throw err;
  } finally {
    client.release();
  }
}

function copyDatabase(sourceDbName, targetDbName, copyData) {
  return new Promise((resolve, reject) => {
    // Ensure temp dir exists
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

    const tempFile = path.join(TEMP_DIR, `fork_${crypto.randomBytes(4).toString('hex')}.dump`);
    const env = { ...process.env };
    if (process.env.DB_PASSWORD) env.PGPASSWORD = process.env.DB_PASSWORD;

    const dumpArgs = [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER || 'vpc_admin',
      '-d', sourceDbName,
      '-F', 'c',
      '--exclude-table=_vpc_schema_changes',
      '-f', tempFile,
    ];
    if (!copyData) dumpArgs.push('--schema-only');

    // Step 1: pg_dump source
    execFile('pg_dump', dumpArgs, { timeout: 300000, env }, (dumpErr) => {
      if (dumpErr) {
        try { fs.unlinkSync(tempFile); } catch {}
        return reject(new Error(`pg_dump failed: ${dumpErr.message}`));
      }

      // Step 2: pg_restore to target
      const restoreArgs = [
        '-h', process.env.DB_HOST || 'localhost',
        '-p', process.env.DB_PORT || '5432',
        '-U', process.env.DB_USER || 'vpc_admin',
        '-d', targetDbName,
        '--no-owner',
        '--no-acl',
        tempFile,
      ];

      execFile('pg_restore', restoreArgs, { timeout: 300000, env }, (restoreErr) => {
        // Clean up temp file
        try { fs.unlinkSync(tempFile); } catch {}

        // pg_restore may return warnings (exit code 1) even on success — check if it's fatal
        if (restoreErr && !restoreErr.message.includes('WARNING')) {
          return reject(new Error(`pg_restore failed: ${restoreErr.message}`));
        }
        resolve();
      });
    });
  });
}

// ─── Schema Diff ────────────────────────────────────────────────────

function diffSchemas(prodSnapshot, betaSnapshot) {
  const prodTableMap = new Map(prodSnapshot.tables.map(t => [t.name, t]));
  const betaTableMap = new Map(betaSnapshot.tables.map(t => [t.name, t]));

  const newTables = [];
  const droppedTables = [];
  const modifiedTables = [];

  // Tables in beta but not in prod = new tables
  for (const [name, betaTable] of betaTableMap) {
    if (!prodTableMap.has(name)) {
      newTables.push(betaTable);
    }
  }

  // Tables in prod but not in beta = dropped tables
  for (const [name] of prodTableMap) {
    if (!betaTableMap.has(name)) {
      droppedTables.push({ name });
    }
  }

  // Tables in both — check for differences
  for (const [name, betaTable] of betaTableMap) {
    const prodTable = prodTableMap.get(name);
    if (!prodTable) continue;

    const prodColMap = new Map(prodTable.columns.map(c => [c.column_name, c]));
    const betaColMap = new Map(betaTable.columns.map(c => [c.column_name, c]));

    const addedColumns = [];
    const droppedColumns = [];
    const modifiedColumns = [];

    // New columns in beta
    for (const [colName, betaCol] of betaColMap) {
      const prodCol = prodColMap.get(colName);
      if (!prodCol) {
        addedColumns.push(betaCol);
      } else {
        // Check for type/nullable/default changes
        const typeChanged = betaCol.data_type !== prodCol.data_type ||
          betaCol.character_maximum_length !== prodCol.character_maximum_length;
        const nullableChanged = betaCol.is_nullable !== prodCol.is_nullable;
        const defaultChanged = betaCol.column_default !== prodCol.column_default;

        if (typeChanged || nullableChanged || defaultChanged) {
          modifiedColumns.push({ column_name: colName, from: prodCol, to: betaCol });
        }
      }
    }

    // Dropped columns
    for (const [colName] of prodColMap) {
      if (!betaColMap.has(colName)) {
        droppedColumns.push({ column_name: colName });
      }
    }

    // Index diff
    const prodIndexMap = new Map(prodTable.indexes.map(i => [i.indexname, i]));
    const betaIndexMap = new Map(betaTable.indexes.map(i => [i.indexname, i]));
    const addedIndexes = [];
    const droppedIndexes = [];

    for (const [idxName, betaIdx] of betaIndexMap) {
      if (!prodIndexMap.has(idxName)) addedIndexes.push(betaIdx);
    }
    for (const [idxName, prodIdx] of prodIndexMap) {
      if (!betaIndexMap.has(idxName)) droppedIndexes.push(prodIdx);
    }

    // Constraint diff
    const prodConMap = new Map(prodTable.constraints.map(c => [c.constraint_name, c]));
    const betaConMap = new Map(betaTable.constraints.map(c => [c.constraint_name, c]));
    const addedConstraints = [];

    for (const [conName, betaCon] of betaConMap) {
      if (!prodConMap.has(conName)) addedConstraints.push(betaCon);
    }

    if (addedColumns.length || droppedColumns.length || modifiedColumns.length ||
        addedIndexes.length || droppedIndexes.length || addedConstraints.length) {
      modifiedTables.push({
        name,
        addedColumns,
        droppedColumns,
        modifiedColumns,
        addedIndexes,
        droppedIndexes,
        addedConstraints,
      });
    }
  }

  return {
    newTables,
    droppedTables,
    modifiedTables,
    summary: {
      newTables: newTables.length,
      droppedTables: droppedTables.length,
      modifiedTables: modifiedTables.length,
      newColumns: modifiedTables.reduce((s, t) => s + t.addedColumns.length, 0),
      newIndexes: modifiedTables.reduce((s, t) => s + t.addedIndexes.length, 0),
    },
  };
}

// ─── Generate Promotion SQL ─────────────────────────────────────────

function generatePromoteSQL(diff) {
  const lines = [];

  // 1. CREATE TABLE for new tables
  for (const table of diff.newTables) {
    const colDefs = table.columns.map(col => {
      let def = `  "${col.column_name}" ${buildColumnType(col)}`;
      if (col.is_nullable === 'NO') def += ' NOT NULL';
      if (col.column_default) def += ` DEFAULT ${col.column_default}`;
      return def;
    });

    // Add primary key constraint inline
    const pkConstraint = table.constraints?.find(c => c.constraint_type === 'PRIMARY KEY');
    if (pkConstraint) {
      const pkCols = table.constraints
        .filter(c => c.constraint_name === pkConstraint.constraint_name)
        .map(c => `"${c.column_name}"`)
        .join(', ');
      colDefs.push(`  PRIMARY KEY (${pkCols})`);
    }

    // Add unique constraints
    const uniqueConstraints = new Set();
    for (const con of (table.constraints || [])) {
      if (con.constraint_type === 'UNIQUE' && !uniqueConstraints.has(con.constraint_name)) {
        uniqueConstraints.add(con.constraint_name);
        const uniqueCols = table.constraints
          .filter(c => c.constraint_name === con.constraint_name)
          .map(c => `"${c.column_name}"`)
          .join(', ');
        colDefs.push(`  UNIQUE (${uniqueCols})`);
      }
    }

    lines.push(`CREATE TABLE IF NOT EXISTS "${table.name}" (\n${colDefs.join(',\n')}\n);`);
    lines.push('');

    // Add non-PK, non-unique indexes for this new table
    for (const idx of (table.indexes || [])) {
      // Skip auto-generated PK/unique indexes
      const isPk = table.constraints?.some(c => c.constraint_type === 'PRIMARY KEY' && idx.indexname.includes(c.constraint_name));
      const isUnique = table.constraints?.some(c => c.constraint_type === 'UNIQUE' && idx.indexname.includes(c.constraint_name));
      if (!isPk && !isUnique && idx.indexdef) {
        // indexdef is a complete CREATE INDEX statement from pg_indexes
        lines.push(`${idx.indexdef};`);
      }
    }
    if (table.indexes?.length) lines.push('');
  }

  // 2. ALTER TABLE ADD COLUMN for modified tables
  for (const mod of diff.modifiedTables) {
    for (const col of mod.addedColumns) {
      let stmt = `ALTER TABLE "${mod.name}" ADD COLUMN IF NOT EXISTS "${col.column_name}" ${buildColumnType(col)}`;
      if (col.is_nullable === 'NO' && col.column_default) stmt += ` NOT NULL DEFAULT ${col.column_default}`;
      else if (col.is_nullable === 'NO') stmt += ' NOT NULL';
      if (col.column_default && col.is_nullable !== 'NO') stmt += ` DEFAULT ${col.column_default}`;
      lines.push(`${stmt};`);
    }

    // New indexes on existing tables
    for (const idx of mod.addedIndexes) {
      if (idx.indexdef) {
        // Replace CREATE INDEX with CREATE INDEX IF NOT EXISTS
        const safeIdx = idx.indexdef.replace(/^CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
        lines.push(`${safeIdx};`);
      }
    }
  }

  return lines.join('\n').trim();
}

function buildColumnType(col) {
  const { data_type, character_maximum_length } = col;

  // Map information_schema types to PostgreSQL types
  switch (data_type) {
    case 'character varying':
      return character_maximum_length ? `VARCHAR(${character_maximum_length})` : 'VARCHAR';
    case 'character':
      return character_maximum_length ? `CHAR(${character_maximum_length})` : 'CHAR';
    case 'integer': return 'INTEGER';
    case 'bigint': return 'BIGINT';
    case 'smallint': return 'SMALLINT';
    case 'boolean': return 'BOOLEAN';
    case 'text': return 'TEXT';
    case 'numeric': return 'NUMERIC';
    case 'real': return 'REAL';
    case 'double precision': return 'DOUBLE PRECISION';
    case 'date': return 'DATE';
    case 'timestamp without time zone': return 'TIMESTAMP';
    case 'timestamp with time zone': return 'TIMESTAMPTZ';
    case 'time without time zone': return 'TIME';
    case 'time with time zone': return 'TIMETZ';
    case 'json': return 'JSON';
    case 'jsonb': return 'JSONB';
    case 'uuid': return 'UUID';
    case 'bytea': return 'BYTEA';
    case 'ARRAY': return 'TEXT[]';
    case 'USER-DEFINED': return col.udt_name || 'TEXT';
    default: return data_type.toUpperCase();
  }
}

module.exports = { forkProject, diffSchemas, generatePromoteSQL };
