const { quoteIdentifier, validateIdentifier } = require('../utils/sanitize');

const SYSTEM_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

async function getSchemas(pool) {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN (${SYSTEM_SCHEMAS.map((_, i) => `$${i + 1}`).join(',')})
     ORDER BY schema_name`,
    SYSTEM_SCHEMAS
  );
  return rows.map((r) => r.schema_name);
}

async function getTables(pool, schema) {
  validateIdentifier(schema);
  const { rows } = await pool.query(
    `SELECT
       t.table_name,
       COALESCE(s.n_live_tup, 0) AS row_estimate,
       pg_size_pretty(pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))) AS size_pretty
     FROM information_schema.tables t
     LEFT JOIN pg_stat_user_tables s
       ON s.schemaname = t.table_schema AND s.relname = t.table_name
     WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
     ORDER BY t.table_name`,
    [schema]
  );
  return rows;
}

async function getColumns(pool, schema, table) {
  validateIdentifier(schema);
  validateIdentifier(table);
  const { rows } = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default,
            character_maximum_length, numeric_precision, udt_name,
            ordinal_position
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  );
  return rows;
}

async function validateTableExists(pool, schema, table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = $1 AND table_name = $2`,
    [schema, table]
  );
  if (rows.length === 0) throw new Error(`Table "${schema}"."${table}" does not exist`);
}

async function validateColumnsExist(pool, schema, table, columnNames) {
  const columns = await getColumns(pool, schema, table);
  const validColumns = new Set(columns.map((c) => c.column_name));
  for (const col of columnNames) {
    if (!validColumns.has(col)) {
      throw new Error(`Column "${col}" does not exist in "${schema}"."${table}"`);
    }
  }
}

function buildWhereClause(filters, startParamIndex = 1) {
  if (!filters || filters.length === 0) return { clause: '', values: [], nextIndex: startParamIndex };

  const conditions = [];
  const values = [];
  let paramIndex = startParamIndex;

  for (const filter of filters) {
    const col = quoteIdentifier(filter.column);
    const op = filter.operator;

    switch (op) {
      case 'eq':
        conditions.push(`${col} = $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'neq':
        conditions.push(`${col} != $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gt':
        conditions.push(`${col} > $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gte':
        conditions.push(`${col} >= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lt':
        conditions.push(`${col} < $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lte':
        conditions.push(`${col} <= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'like':
        conditions.push(`${col} LIKE $${paramIndex}`);
        values.push(`%${filter.value}%`);
        paramIndex++;
        break;
      case 'ilike':
        conditions.push(`${col} ILIKE $${paramIndex}`);
        values.push(`%${filter.value}%`);
        paramIndex++;
        break;
      case 'is_null':
        conditions.push(`${col} IS NULL`);
        break;
      case 'not_null':
        conditions.push(`${col} IS NOT NULL`);
        break;
      default:
        throw new Error(`Unknown filter operator: "${op}"`);
    }
  }

  return {
    clause: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '',
    values,
    nextIndex: paramIndex,
  };
}

async function getTableData(pool, { schema, table, page, pageSize, offset, sortBy, sortDir, filters }) {
  await validateTableExists(pool, schema, table);

  const columns = await getColumns(pool, schema, table);

  // Parse filters if string
  let parsedFilters = [];
  if (filters) {
    try {
      parsedFilters = typeof filters === 'string' ? JSON.parse(filters) : filters;
    } catch {
      parsedFilters = [];
    }
  }

  // Validate filter columns
  if (parsedFilters.length > 0) {
    await validateColumnsExist(pool, schema, table, parsedFilters.map((f) => f.column));
  }

  // Build WHERE clause
  const where = buildWhereClause(parsedFilters);

  // Build ORDER BY
  let orderClause = '';
  if (sortBy) {
    validateIdentifier(sortBy);
    await validateColumnsExist(pool, schema, table, [sortBy]);
    const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
    orderClause = `ORDER BY ${quoteIdentifier(sortBy)} ${dir}`;
  }

  // Build full query
  const limitParam = where.nextIndex;
  const offsetParam = where.nextIndex + 1;

  const sql = `
    SELECT *, COUNT(*) OVER() AS _total_count
    FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}
    ${where.clause}
    ${orderClause}
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const values = [...where.values, pageSize, offset];
  const { rows } = await pool.query(sql, values);

  const totalCount = rows.length > 0 ? parseInt(rows[0]._total_count) : 0;

  // Remove _total_count from row data
  const cleanRows = rows.map(({ _total_count, ...rest }) => rest);

  return { rows: cleanRows, totalCount, page, pageSize, columns };
}

async function executeQuery(pool, sql, params = [], confirm = false) {
  const trimmed = sql.trim();

  // Strip SQL comments before detecting write operations
  const stripped = trimmed
    .replace(/--[^\n]*/g, '')       // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
    .trim();

  // Detect if it's a write operation
  const isWrite =
    /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|DO)\b/i.test(stripped) ||
    /\bSELECT\b[\s\S]+\bINTO\s+(?!STRICT\b)(?!TEMPORARY\b\s+STRICT\b)\w/i.test(stripped) ||
    /^\s*WITH\b[\s\S]+\b(INSERT|UPDATE|DELETE)\b/i.test(stripped);

  if (isWrite && !confirm) {
    return { requiresConfirmation: true, queryType: 'write' };
  }

  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = '10000'");

    if (!isWrite) {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION READ ONLY');
    }

    const start = Date.now();
    const result = await client.query(trimmed, params);
    const duration_ms = Date.now() - start;

    if (!isWrite) {
      await client.query('ROLLBACK');
    }

    return {
      rows: result.rows || [],
      fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: result.rowCount,
      command: result.command,
      duration_ms,
    };
  } catch (err) {
    if (!isWrite) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    // If query failed due to read-only restriction, prompt for write confirmation
    if (!confirm && err.message && err.message.includes('read-only transaction')) {
      return { requiresConfirmation: true, queryType: 'write' };
    }
    throw err;
  } finally {
    client.release();
  }
}

async function insertRow(pool, schema, table, data) {
  await validateTableExists(pool, schema, table);
  const columns = Object.keys(data);
  await validateColumnsExist(pool, schema, table, columns);

  const quotedCols = columns.map(quoteIdentifier).join(', ');
  const params = columns.map((_, i) => `$${i + 1}`).join(', ');
  const values = columns.map((col) => data[col]);

  const sql = `INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier(table)} (${quotedCols}) VALUES (${params}) RETURNING *`;
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function updateRow(pool, schema, table, primaryKey, pkValue, data) {
  await validateTableExists(pool, schema, table);
  const columns = Object.keys(data);
  await validateColumnsExist(pool, schema, table, [...columns, primaryKey]);

  const setClauses = columns.map((col, i) => `${quoteIdentifier(col)} = $${i + 1}`).join(', ');
  const values = [...columns.map((col) => data[col]), pkValue];

  const sql = `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setClauses} WHERE ${quoteIdentifier(primaryKey)} = $${values.length} RETURNING *`;
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

async function deleteRow(pool, schema, table, primaryKey, pkValue) {
  await validateTableExists(pool, schema, table);
  await validateColumnsExist(pool, schema, table, [primaryKey]);

  const sql = `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE ${quoteIdentifier(primaryKey)} = $1`;
  const { rowCount } = await pool.query(sql, [pkValue]);
  return { deleted: rowCount > 0 };
}

// ─── SQL Editor: multi-statement support ───────────────

function splitStatements(sql) {
  const stmts = [];
  let cur = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1] || '';

    // Single-quoted string
    if (ch === "'") {
      cur += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { cur += "''"; i += 2; }
        else if (sql[i] === "'") { cur += "'"; i++; break; }
        else { cur += sql[i]; i++; }
      }
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      cur += ch;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"' && sql[i + 1] === '"') { cur += '""'; i += 2; }
        else if (sql[i] === '"') { cur += '"'; i++; break; }
        else { cur += sql[i]; i++; }
      }
      continue;
    }

    // Dollar-quoted string ($$...$$)
    if (ch === '$') {
      let tag = '$';
      let j = i + 1;
      while (j < sql.length && (/[a-zA-Z0-9_]/.test(sql[j]) || sql[j] === '$')) {
        tag += sql[j];
        if (sql[j] === '$') { j++; break; }
        j++;
      }
      if (tag.length >= 2 && tag.endsWith('$')) {
        cur += tag;
        i = j;
        const closeIdx = sql.indexOf(tag, i);
        if (closeIdx >= 0) {
          cur += sql.substring(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
        } else {
          cur += sql.substring(i);
          i = sql.length;
        }
        continue;
      }
      cur += ch;
      i++;
      continue;
    }

    // Line comment
    if (ch === '-' && next === '-') {
      const nlIdx = sql.indexOf('\n', i);
      if (nlIdx >= 0) { cur += sql.substring(i, nlIdx + 1); i = nlIdx + 1; }
      else { cur += sql.substring(i); i = sql.length; }
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const closeIdx = sql.indexOf('*/', i + 2);
      if (closeIdx >= 0) { cur += sql.substring(i, closeIdx + 2); i = closeIdx + 2; }
      else { cur += sql.substring(i); i = sql.length; }
      continue;
    }

    // Semicolon — statement separator
    if (ch === ';') {
      const stmt = cur.trim();
      if (stmt) stmts.push(stmt);
      cur = '';
      i++;
      continue;
    }

    cur += ch;
    i++;
  }

  const last = cur.trim();
  if (last) stmts.push(last);
  return stmts;
}

function isWriteStatement(sql) {
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  return (
    /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|DO)\b/i.test(stripped) ||
    /\bSELECT\b[\s\S]+\bINTO\s+(?!STRICT\b)(?!TEMPORARY\b\s+STRICT\b)\w/i.test(stripped) ||
    /^\s*WITH\b[\s\S]+\b(INSERT|UPDATE|DELETE)\b/i.test(stripped)
  );
}

async function executeEditorQuery(pool, sql, confirm = false) {
  const trimmed = sql.trim();
  if (!trimmed) return { results: [] };

  const statements = splitStatements(trimmed);
  if (statements.length === 0) return { results: [] };

  const hasWrite = statements.some(isWriteStatement);

  if (hasWrite && !confirm) {
    return { requiresConfirmation: true, queryType: 'write' };
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    return {
      results: [{ rows: [], fields: [], rowCount: 0, command: null, duration_ms: 0, sql: trimmed, success: false, error: 'Database connection failed: ' + err.message }],
      duration_ms: 0,
    };
  }

  const totalStart = Date.now();
  const results = [];

  try {
    await client.query("SET statement_timeout = '30000'");

    // Read-only batch: wrap in read-only transaction
    if (!hasWrite) {
      await client.query('BEGIN');
      await client.query('SET TRANSACTION READ ONLY');
    }

    for (const stmt of statements) {
      const start = Date.now();
      try {
        const result = await client.query(stmt);
        results.push({
          rows: result.rows || [],
          fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
          rowCount: result.rowCount,
          command: result.command,
          duration_ms: Date.now() - start,
          sql: stmt.length > 300 ? stmt.substring(0, 300) + '...' : stmt,
          success: true,
        });
      } catch (err) {
        results.push({
          rows: [],
          fields: [],
          rowCount: 0,
          command: null,
          duration_ms: Date.now() - start,
          sql: stmt.length > 300 ? stmt.substring(0, 300) + '...' : stmt,
          success: false,
          error: err.message,
        });
        break; // stop on first error
      }
    }

    if (!hasWrite) {
      try { await client.query('ROLLBACK'); } catch {}
    }
  } catch (err) {
    // Catch any setup errors (BEGIN, SET TRANSACTION, etc.) — never throw 500
    if (!hasWrite) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    if (results.length === 0) {
      results.push({
        rows: [], fields: [], rowCount: 0, command: null,
        duration_ms: Date.now() - totalStart, sql: trimmed,
        success: false, error: err.message,
      });
    }
  } finally {
    client.release();
  }

  return { results, duration_ms: Date.now() - totalStart };
}

module.exports = {
  getSchemas,
  getTables,
  getColumns,
  getTableData,
  executeQuery,
  executeEditorQuery,
  insertRow,
  updateRow,
  deleteRow,
  validateTableExists,
  validateColumnsExist,
};
