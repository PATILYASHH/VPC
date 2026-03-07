const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dbBrowser = require('../services/dbBrowserService');
const exportService = require('../services/exportService');
const { parsePagination } = require('../utils/pagination');

const router = express.Router();

// Multer config for file imports
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  },
});

// GET /db/schemas
router.get('/schemas', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schemas = await dbBrowser.getSchemas(pool);
    res.json({ schemas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /db/tables?schema=public
router.get('/tables', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const tables = await dbBrowser.getTables(pool, schema);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /db/table/:name/columns?schema=public
router.get('/table/:name/columns', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const columns = await dbBrowser.getColumns(pool, schema, req.params.name);
    res.json({ columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /db/table/:name?schema=public&page=1&pageSize=50&sortBy=&sortDir=asc&filters=[]
router.get('/table/:name', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const { page, pageSize, offset } = parsePagination(req.query);
    const sortBy = req.query.sortBy || '';
    const sortDir = req.query.sortDir || 'asc';
    const filters = req.query.filters || '[]';

    const data = await dbBrowser.getTableData(pool, {
      schema,
      table: req.params.name,
      page,
      pageSize,
      offset,
      sortBy,
      sortDir,
      filters,
    });

    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /db/query
router.post('/query', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { sql, confirm } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL query is required' });
    }

    const result = await dbBrowser.executeEditorQuery(pool, sql, !!confirm);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /db/table/:name/row
router.post('/table/:name/row', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const { data } = req.body;

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Row data is required' });
    }

    const row = await dbBrowser.insertRow(pool, schema, req.params.name, data);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /db/table/:name/row/:id
router.put('/table/:name/row/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const { data, primaryKey } = req.body;
    const pk = primaryKey || 'id';

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Row data is required' });
    }

    const row = await dbBrowser.updateRow(pool, schema, req.params.name, pk, req.params.id, data);
    if (!row) return res.status(404).json({ error: 'Row not found' });
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /db/table/:name/row/:id
router.delete('/table/:name/row/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const schema = req.query.schema || 'public';
    const primaryKey = req.query.primaryKey || 'id';

    const result = await dbBrowser.deleteRow(pool, schema, req.params.name, primaryKey, req.params.id);
    res.json({ message: result.deleted ? 'Row deleted' : 'Row not found' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /db/import
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { table, schema = 'public', columnMapping } = req.body;

    if (!req.file) return res.status(400).json({ error: 'File is required' });
    if (!table) return res.status(400).json({ error: 'Table name is required' });

    const rows = await exportService.parseFile(req.file.path, req.file.mimetype);
    let mapping = null;
    if (columnMapping) {
      try { mapping = JSON.parse(columnMapping); } catch { mapping = null; }
    }

    let inserted = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        let rowData = rows[i];
        if (mapping) {
          const mapped = {};
          for (const [src, dest] of Object.entries(mapping)) {
            if (rowData[src] !== undefined) mapped[dest] = rowData[src];
          }
          rowData = mapped;
        }

        // Remove empty string keys
        const cleanData = {};
        for (const [k, v] of Object.entries(rowData)) {
          if (k) cleanData[k] = v === '' ? null : v;
        }

        await dbBrowser.insertRow(pool, schema, table, cleanData);
        inserted++;
      } catch (err) {
        errors.push({ row: i + 1, error: err.message });
      }
    }

    // Clean up uploaded file
    fs.unlink(req.file.path, () => {});

    res.json({ inserted, errors, total: rows.length });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message });
  }
});

// GET /db/export?table=&schema=public&format=csv&columns=
router.get('/export', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { table, schema = 'public', format = 'csv', columns: colStr } = req.query;

    if (!table) return res.status(400).json({ error: 'Table name is required' });

    await dbBrowser.validateTableExists(pool, schema, table);

    // Get columns
    const allColumns = await dbBrowser.getColumns(pool, schema, table);
    let selectedColumns = allColumns.map((c) => c.column_name);
    if (colStr) {
      const requested = colStr.split(',').map((c) => c.trim());
      await dbBrowser.validateColumnsExist(pool, schema, table, requested);
      selectedColumns = requested;
    }

    const quotedCols = selectedColumns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
    const { rows } = await pool.query(`SELECT ${quotedCols} FROM "${schema}"."${table}"`);

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${table}_${timestamp}`;

    if (format === 'xlsx') {
      const buffer = await exportService.toExcelBuffer(rows, selectedColumns, table);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(buffer);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);

      // Write CSV directly
      const header = selectedColumns.join(',') + '\n';
      res.write(header);
      for (const row of rows) {
        const line = selectedColumns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        }).join(',') + '\n';
        res.write(line);
      }
      res.end();
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
