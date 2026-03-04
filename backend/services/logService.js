const fs = require('fs');
const readline = require('readline');

async function readLogFile(filePath, { search, lines = 100 } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { lines: [], total: 0, error: `File not found: ${filePath}` };
  }

  return new Promise((resolve, reject) => {
    const allLines = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      allLines.push(line);
    });

    rl.on('close', () => {
      let result = allLines;

      // Filter by search term
      if (search) {
        const term = search.toLowerCase();
        result = result.filter((l) => l.toLowerCase().includes(term));
      }

      // Return last N lines
      const total = result.length;
      result = result.slice(-lines);

      resolve({ lines: result, total });
    });

    rl.on('error', reject);
  });
}

module.exports = { readLogFile };
