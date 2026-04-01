/**
 * VPC VCS Client-Side Diff
 * Reuses same Myers algorithm as server
 */

function myersDiff(aLines, bLines) {
  const N = aLines.length;
  const M = bLines.length;
  const MAX = N + M;
  if (MAX === 0) return [];
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
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }
      let y = x - k;
      while (x < N && y < M && aLines[x] === bLines[y]) { x++; y++; }
      newV[kIdx] = x;
      if (x >= N && y >= M) {
        trace.push(newV);
        return buildEditScript(trace, aLines, bLines, MAX);
      }
    }
    trace.push(newV);
    for (let i = 0; i < vSize; i++) v[i] = newV[i];
  }
  return [];
}

function buildEditScript(trace, aLines, bLines, MAX) {
  const ops = [];
  let x = aLines.length, y = bLines.length;

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

    while (x > prevX && y > prevY) { x--; y--; ops.unshift({ type: 'equal', value: aLines[x] }); }
    if (d > 0) {
      if (x === prevX && y > prevY) { y--; ops.unshift({ type: 'insert', value: bLines[y] }); }
      else if (y === prevY && x > prevX) { x--; ops.unshift({ type: 'delete', value: aLines[x] }); }
    }
  }
  return ops;
}

function diffLines(textA, textB) {
  const aLines = textA.split('\n');
  const bLines = textB.split('\n');
  const ops = myersDiff(aLines, bLines);

  // Simple output: show deletions and insertions
  const result = [];
  for (const op of ops) {
    if (op.type === 'delete') result.push(`-${op.value}`);
    else if (op.type === 'insert') result.push(`+${op.value}`);
    else result.push(` ${op.value}`);
  }
  return result;
}

module.exports = { myersDiff, diffLines };
