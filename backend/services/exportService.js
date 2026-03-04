const ExcelJS = require('exceljs');
const csv = require('csv-parser');
const fs = require('fs');
const { Transform } = require('stream');

async function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('No worksheets found in file');

  const rows = [];
  const headers = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell((cell) => headers.push(String(cell.value)));
    } else {
      const obj = {};
      row.eachCell((cell, colNumber) => {
        if (headers[colNumber - 1]) {
          obj[headers[colNumber - 1]] = cell.value;
        }
      });
      rows.push(obj);
    }
  });

  return rows;
}

async function parseFile(filePath, mimetype) {
  if (mimetype === 'text/csv' || filePath.endsWith('.csv')) {
    return parseCSV(filePath);
  }
  return parseExcel(filePath);
}

function toCSVStream(rows, columns) {
  const header = columns.join(',') + '\n';
  let index = 0;

  return new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      callback(null, chunk);
    },
    read(size) {
      if (index === 0) {
        this.push(header);
        index++;
      }
      while (index <= rows.length) {
        const row = rows[index - 1];
        if (!row) {
          this.push(null);
          return;
        }
        const line = columns.map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        }).join(',') + '\n';
        index++;
        if (!this.push(line)) return;
      }
    },
  });
}

async function toExcelBuffer(rows, columns, sheetName = 'Data') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  worksheet.columns = columns.map((col) => ({
    header: col,
    key: col,
    width: Math.max(col.length + 2, 15),
  }));

  for (const row of rows) {
    worksheet.addRow(row);
  }

  // Style header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  return workbook.xlsx.writeBuffer();
}

module.exports = { parseFile, toCSVStream, toExcelBuffer };
