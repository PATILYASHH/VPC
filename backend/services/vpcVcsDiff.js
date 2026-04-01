/**
 * VPC VCS Diff Engine
 *
 * Myers diff algorithm for line-level diffs,
 * tree comparison for file-level changes,
 * unified diff formatting.
 */

const vcsCore = require('./vpcVcsCore');

// ─── Myers Diff Algorithm ────────────────────────────────────

/**
 * Compute the shortest edit script between two arrays using Myers algorithm.
 * Returns an array of operations: { type: 'equal'|'insert'|'delete', value: string }
 */
function myersDiff(aLines, bLines) {
  const N = aLines.length;
  const M = bLines.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  // Fast paths
  if (N === 0) return bLines.map(v => ({ type: 'insert', value: v }));
  if (M === 0) return aLines.map(v => ({ type: 'delete', value: v }));

  const vSize = 2 * MAX + 1;
  const v = new Array(vSize).fill(0);
  const trace = [];

  for (let d = 0; d <= MAX; d++) {
    const newV = [...v];
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + MAX;
      let x;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1]; // move down
      } else {
        x = v[kIdx - 1] + 1; // move right
      }
      let y = x - k;

      // Follow diagonal (equal elements)
      while (x < N && y < M && aLines[x] === bLines[y]) {
        x++;
        y++;
      }

      newV[kIdx] = x;

      if (x >= N && y >= M) {
        trace.push(newV);
        return buildEditScript(trace, aLines, bLines, MAX);
      }
    }
    trace.push(newV);
    for (let i = 0; i < vSize; i++) v[i] = newV[i];
  }

  // Shouldn't reach here
  return aLines.map(v => ({ type: 'delete', value: v }))
    .concat(bLines.map(v => ({ type: 'insert', value: v })));
}

function buildEditScript(trace, aLines, bLines, MAX) {
  const ops = [];
  let x = aLines.length;
  let y = bLines.length;

  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d];
    const k = x - y;
    const kIdx = k + MAX;

    let prevK;
    if (k === -d || (k !== d && (d === 0 ? 0 : trace[Math.max(0, d - 1)][kIdx - 1]) < (d === 0 ? 0 : trace[Math.max(0, d - 1)][kIdx + 1]))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = d > 0 ? trace[d - 1][prevK + MAX] : 0;
    const prevY = prevX - prevK;

    // Follow diagonal backwards
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.unshift({ type: 'equal', value: aLines[x] });
    }

    if (d > 0) {
      if (x === prevX && y > prevY) {
        y--;
        ops.unshift({ type: 'insert', value: bLines[y] });
      } else if (y === prevY && x > prevX) {
        x--;
        ops.unshift({ type: 'delete', value: aLines[x] });
      }
    }
  }

  return ops;
}

// ─── Line Diffing ──────────────���─────────────────────────────

/**
 * Compute unified diff hunks between two text strings
 * @returns {Array<{oldStart: number, oldCount: number, newStart: number, newCount: number, lines: string[]}>}
 */
function diffLines(textA, textB) {
  const aLines = textA.split('\n');
  const bLines = textB.split('\n');

  const ops = myersDiff(aLines, bLines);

  // Group operations into hunks with context
  const contextLines = 3;
  const hunks = [];
  let currentHunk = null;
  let oldLine = 1;
  let newLine = 1;
  let lastChangeIdx = -999;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const isChange = op.type !== 'equal';

    if (isChange) {
      // Check if we need a new hunk or extend current
      if (!currentHunk || i - lastChangeIdx > contextLines * 2) {
        // Start new hunk — include leading context
        if (currentHunk) {
          // Add trailing context to previous hunk
          let trailing = 0;
          for (let j = lastChangeIdx + 1; j < i && trailing < contextLines; j++) {
            if (ops[j].type === 'equal') {
              currentHunk.lines.push(' ' + ops[j].value);
              currentHunk.oldCount++;
              currentHunk.newCount++;
              trailing++;
            }
          }
          hunks.push(currentHunk);
        }

        // Calculate line numbers at this point
        let oLine = 1, nLine = 1;
        for (let j = 0; j < i; j++) {
          if (ops[j].type === 'equal' || ops[j].type === 'delete') oLine++;
          if (ops[j].type === 'equal' || ops[j].type === 'insert') nLine++;
        }

        // Leading context
        const leadStart = Math.max(0, i - contextLines);
        let leadOldLine = oLine;
        let leadNewLine = nLine;
        const leadLines = [];
        for (let j = leadStart; j < i; j++) {
          if (ops[j].type === 'equal') {
            leadLines.push(' ' + ops[j].value);
            leadOldLine--;
            leadNewLine--;
          }
        }
        // Adjust the start lines back for context
        leadOldLine = Math.max(1, leadOldLine);
        leadNewLine = Math.max(1, leadNewLine);

        currentHunk = {
          oldStart: oLine - leadLines.length,
          oldCount: leadLines.length,
          newStart: nLine - leadLines.length,
          newCount: leadLines.length,
          lines: [...leadLines],
        };
      }

      // Add the change
      if (op.type === 'delete') {
        currentHunk.lines.push('-' + op.value);
        currentHunk.oldCount++;
      } else if (op.type === 'insert') {
        currentHunk.lines.push('+' + op.value);
        currentHunk.newCount++;
      }

      lastChangeIdx = i;
    }
  }

  // Flush last hunk with trailing context
  if (currentHunk) {
    let trailing = 0;
    for (let j = lastChangeIdx + 1; j < ops.length && trailing < contextLines; j++) {
      if (ops[j].type === 'equal') {
        currentHunk.lines.push(' ' + ops[j].value);
        currentHunk.oldCount++;
        currentHunk.newCount++;
        trailing++;
      }
    }
    hunks.push(currentHunk);
  }

  return hunks;
}

// ─── Tree Diffing ────────────────────────────────────────────

/**
 * Compare two trees and return list of changed files
 * @returns {Array<{status: string, path: string, oldHash: string|null, newHash: string|null}>}
 * status: 'A' (added), 'M' (modified), 'D' (deleted)
 */
function diffTrees(repoPath, treeHashA, treeHashB, basePath = '') {
  const changes = [];

  // Get flat manifests for both trees
  const manifestA = treeHashA ? buildManifestMap(repoPath, treeHashA) : new Map();
  const manifestB = treeHashB ? buildManifestMap(repoPath, treeHashB) : new Map();

  // Find deleted and modified files
  for (const [filePath, hashA] of manifestA) {
    const hashB = manifestB.get(filePath);
    if (!hashB) {
      changes.push({ status: 'D', path: filePath, oldHash: hashA, newHash: null });
    } else if (hashA !== hashB) {
      changes.push({ status: 'M', path: filePath, oldHash: hashA, newHash: hashB });
    }
  }

  // Find added files
  for (const [filePath, hashB] of manifestB) {
    if (!manifestA.has(filePath)) {
      changes.push({ status: 'A', path: filePath, oldHash: null, newHash: hashB });
    }
  }

  // Sort by path
  changes.sort((a, b) => a.path.localeCompare(b.path));

  return changes;
}

/**
 * Build a Map of path → hash from a tree
 */
function buildManifestMap(repoPath, treeHash) {
  const manifest = vcsCore.walkTree(repoPath, treeHash);
  const map = new Map();
  for (const entry of manifest) {
    map.set(entry.path, entry.hash);
  }
  return map;
}

// ─── Unified Diff Formatting ─────────���───────────────────────

/**
 * Generate a full unified diff string between two commits
 */
function diffCommits(repoPath, commitHashA, commitHashB) {
  const commitA = commitHashA ? vcsCore.readCommit(repoPath, commitHashA) : null;
  const commitB = commitHashB ? vcsCore.readCommit(repoPath, commitHashB) : null;

  const treeA = commitA ? commitA.tree : null;
  const treeB = commitB ? commitB.tree : null;

  const changes = diffTrees(repoPath, treeA, treeB);
  return formatUnifiedDiff(repoPath, changes);
}

/**
 * Format tree changes as unified diff text
 * @param {Array<{status: string, path: string, oldHash: string|null, newHash: string|null}>} changes
 * @returns {string}
 */
function formatUnifiedDiff(repoPath, changes) {
  const diffParts = [];

  for (const change of changes) {
    let oldContent = '';
    let newContent = '';

    try {
      if (change.oldHash) {
        oldContent = vcsCore.readBlob(repoPath, change.oldHash).toString('utf8');
      }
    } catch { /* binary or missing */ }

    try {
      if (change.newHash) {
        newContent = vcsCore.readBlob(repoPath, change.newHash).toString('utf8');
      }
    } catch { /* binary or missing */ }

    // Check if binary
    const isBinary = isBinaryContent(oldContent) || isBinaryContent(newContent);

    const oldPath = change.status === 'A' ? '/dev/null' : `a/${change.path}`;
    const newPath = change.status === 'D' ? '/dev/null' : `b/${change.path}`;

    diffParts.push(`diff --vpc a/${change.path} b/${change.path}`);

    if (change.status === 'A') {
      diffParts.push('new file');
    } else if (change.status === 'D') {
      diffParts.push('deleted file');
    }

    if (isBinary) {
      diffParts.push(`Binary files ${oldPath} and ${newPath} differ`);
      diffParts.push('');
      continue;
    }

    diffParts.push(`--- ${oldPath}`);
    diffParts.push(`+++ ${newPath}`);

    const hunks = diffLines(oldContent, newContent);
    for (const hunk of hunks) {
      diffParts.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
      for (const line of hunk.lines) {
        diffParts.push(line);
      }
    }

    diffParts.push('');
  }

  return diffParts.join('\n');
}

/**
 * Simple binary content detection
 */
function isBinaryContent(content) {
  if (!content) return false;
  // Check first 8000 bytes for null bytes
  const check = content.slice(0, 8000);
  return check.includes('\0');
}

/**
 * Get stats for a diff (files changed, insertions, deletions)
 */
function diffStats(repoPath, changes) {
  let filesChanged = changes.length;
  let insertions = 0;
  let deletions = 0;

  for (const change of changes) {
    try {
      const oldContent = change.oldHash ? vcsCore.readBlob(repoPath, change.oldHash).toString('utf8') : '';
      const newContent = change.newHash ? vcsCore.readBlob(repoPath, change.newHash).toString('utf8') : '';

      if (isBinaryContent(oldContent) || isBinaryContent(newContent)) continue;

      const hunks = diffLines(oldContent, newContent);
      for (const hunk of hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) insertions++;
          else if (line.startsWith('-')) deletions++;
        }
      }
    } catch { /* ignore */ }
  }

  return { filesChanged, insertions, deletions };
}

/**
 * Format stats as a string like git's --stat output
 */
function formatDiffStats(repoPath, changes) {
  const lines = [];

  for (const change of changes) {
    let adds = 0, dels = 0;
    try {
      const oldContent = change.oldHash ? vcsCore.readBlob(repoPath, change.oldHash).toString('utf8') : '';
      const newContent = change.newHash ? vcsCore.readBlob(repoPath, change.newHash).toString('utf8') : '';

      if (!isBinaryContent(oldContent) && !isBinaryContent(newContent)) {
        const hunks = diffLines(oldContent, newContent);
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.startsWith('+')) adds++;
            else if (line.startsWith('-')) dels++;
          }
        }
      }
    } catch { /* ignore */ }

    const bar = '+'.repeat(Math.min(adds, 30)) + '-'.repeat(Math.min(dels, 30));
    lines.push(` ${change.path} | ${adds + dels} ${bar}`);
  }

  const stats = diffStats(repoPath, changes);
  lines.push(`\n ${stats.filesChanged} file(s) changed, ${stats.insertions} insertion(s)(+), ${stats.deletions} deletion(s)(-)`);

  return lines.join('\n');
}

module.exports = {
  myersDiff,
  diffLines,
  diffTrees,
  diffCommits,
  formatUnifiedDiff,
  formatDiffStats,
  diffStats,
  isBinaryContent,
};
