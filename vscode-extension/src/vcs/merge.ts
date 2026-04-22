/**
 * Client-side 3-way merge — lets the IDE detect conflicts BEFORE push reaches main.
 * Ported from backend/services/vpcVcsMerge.js so conflicts surface in SCM for manual fix.
 */

import * as objects from './objects';

export interface MergeFile {
  path: string;
  hash: string;
  mode: string;
}

export interface MergeConflict {
  path: string;
  type: 'content' | 'binary' | 'modify-delete' | 'delete-modify';
  mergedContent?: string;
  conflictCount?: number;
}

export interface MergeOutcome {
  hasConflicts: boolean;
  conflicts: MergeConflict[];
  mergedFiles: MergeFile[];
  mergedTreeHash: string;
  base: string | null;
}

interface DiffOp { type: 'equal' | 'insert' | 'delete'; value: string; }

// ─── Ancestry ───────────────────────────────────────────────

export function findMergeBase(root: string, a: string, b: string): string | null {
  if (a === b) return a;
  const ancA = new Set<string>();
  const ancB = new Set<string>();
  const qA = [a];
  const qB = [b];
  while (qA.length || qB.length) {
    if (qA.length) {
      const h = qA.shift()!;
      if (ancB.has(h)) return h;
      if (!ancA.has(h)) {
        ancA.add(h);
        try { for (const p of objects.readCommit(root, h).parents) if (!ancA.has(p)) qA.push(p); } catch { /* end */ }
      }
    }
    if (qB.length) {
      const h = qB.shift()!;
      if (ancA.has(h)) return h;
      if (!ancB.has(h)) {
        ancB.add(h);
        try { for (const p of objects.readCommit(root, h).parents) if (!ancB.has(p)) qB.push(p); } catch { /* end */ }
      }
    }
  }
  return null;
}

export function isAncestor(root: string, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const visited = new Set<string>();
  const q = [descendant];
  while (q.length) {
    const h = q.shift()!;
    if (h === ancestor) return true;
    if (visited.has(h)) continue;
    visited.add(h);
    try { for (const p of objects.readCommit(root, h).parents) if (!visited.has(p)) q.push(p); } catch { break; }
  }
  return false;
}

// ─── Myers diff ─────────────────────────────────────────────

function myersDiff(a: string[], b: string[]): DiffOp[] {
  const N = a.length, M = b.length, MAX = N + M;
  if (MAX === 0) return [];
  if (N === 0) return b.map(v => ({ type: 'insert' as const, value: v }));
  if (M === 0) return a.map(v => ({ type: 'delete' as const, value: v }));

  const vSize = 2 * MAX + 1;
  const v: number[] = new Array(vSize).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= MAX; d++) {
    const newV = [...v];
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + MAX;
      let x: number;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) x = v[kIdx + 1];
      else x = v[kIdx - 1] + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      newV[kIdx] = x;
      if (x >= N && y >= M) { trace.push(newV); return buildEditScript(trace, a, b, MAX); }
    }
    trace.push(newV);
    for (let i = 0; i < vSize; i++) v[i] = newV[i];
  }
  return (a.map(val => ({ type: 'delete' as const, value: val })) as DiffOp[])
    .concat(b.map(val => ({ type: 'insert' as const, value: val })));
}

function buildEditScript(trace: number[][], a: string[], b: string[], MAX: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length, y = b.length;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const k = x - y;
    let prevK: number;
    const prev = d > 0 ? trace[d - 1] : null;
    if (k === -d || (k !== d && prev && prev[k - 1 + MAX] < prev[k + 1 + MAX])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = prev ? prev[prevK + MAX] : 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; ops.unshift({ type: 'equal', value: a[x] }); }
    if (d > 0) {
      if (x === prevX && y > prevY) { y--; ops.unshift({ type: 'insert', value: b[y] }); }
      else if (y === prevY && x > prevX) { x--; ops.unshift({ type: 'delete', value: a[x] }); }
    }
  }
  return ops;
}

// ─── 3-way merge ────────────────────────────────────────────

function isBinary(content: string): boolean {
  return content.slice(0, 8000).includes('\0');
}

interface ThreeWayResult { merged: string; hasConflicts: boolean; conflictCount: number; }

function threeWayMerge(base: string, ours: string, theirs: string): ThreeWayResult {
  if (ours === theirs) return { merged: ours, hasConflicts: false, conflictCount: 0 };
  if (ours === base) return { merged: theirs, hasConflicts: false, conflictCount: 0 };
  if (theirs === base) return { merged: ours, hasConflicts: false, conflictCount: 0 };

  const baseLines = base.split('\n');
  const ourLines = ours.split('\n');
  const theirLines = theirs.split('\n');
  const ourOps = myersDiff(baseLines, ourLines);
  const theirOps = myersDiff(baseLines, theirLines);
  const ourChanges = buildChangeMap(ourOps);
  const theirChanges = buildChangeMap(theirOps);

  const result: string[] = [];
  let hasConflicts = false;
  let conflictCount = 0;
  let baseIdx = 0;

  while (baseIdx <= baseLines.length) {
    const oC = ourChanges.get(baseIdx);
    const tC = theirChanges.get(baseIdx);
    if (!oC && !tC) {
      if (baseIdx < baseLines.length) result.push(baseLines[baseIdx]);
      baseIdx++;
    } else if (oC && !tC) {
      result.push(...oC.newLines);
      baseIdx += oC.baseConsumed;
    } else if (!oC && tC) {
      result.push(...tC.newLines);
      baseIdx += tC.baseConsumed;
    } else if (oC && tC) {
      if (oC.newLines.join('\n') === tC.newLines.join('\n')) {
        result.push(...oC.newLines);
        baseIdx += Math.max(oC.baseConsumed, tC.baseConsumed);
      } else {
        hasConflicts = true;
        conflictCount++;
        result.push('<<<<<<< ours');
        result.push(...oC.newLines);
        result.push('=======');
        result.push(...tC.newLines);
        result.push('>>>>>>> theirs');
        baseIdx += Math.max(oC.baseConsumed, tC.baseConsumed);
      }
    }
  }
  return { merged: result.join('\n'), hasConflicts, conflictCount };
}

function buildChangeMap(ops: DiffOp[]): Map<number, { newLines: string[]; baseConsumed: number }> {
  const changes = new Map<number, { newLines: string[]; baseConsumed: number }>();
  let baseIdx = 0;
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === 'equal') { baseIdx++; i++; continue; }
    const newLines: string[] = [];
    let baseConsumed = 0;
    const start = baseIdx;
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'insert') newLines.push(ops[i].value);
      else if (ops[i].type === 'delete') { baseConsumed++; baseIdx++; }
      i++;
    }
    changes.set(start, { newLines, baseConsumed: Math.max(baseConsumed, 1) });
  }
  return changes;
}

// ─── Full merge ─────────────────────────────────────────────

export function mergeTrees(root: string, ours: string, theirs: string): MergeOutcome {
  const base = findMergeBase(root, ours, theirs);
  const baseCommit = base ? objects.readCommit(root, base) : null;
  const oursCommit = objects.readCommit(root, ours);
  const theirsCommit = objects.readCommit(root, theirs);

  const baseFiles = baseCommit ? manifestMap(objects.walkTree(root, baseCommit.tree)) : new Map<string, string>();
  const oursFiles = manifestMap(objects.walkTree(root, oursCommit.tree));
  const theirsFiles = manifestMap(objects.walkTree(root, theirsCommit.tree));
  const allPaths = new Set<string>([...baseFiles.keys(), ...oursFiles.keys(), ...theirsFiles.keys()]);

  const mergedFiles: MergeFile[] = [];
  const conflicts: MergeConflict[] = [];

  for (const fp of allPaths) {
    const bH = baseFiles.get(fp) || null;
    const oH = oursFiles.get(fp) || null;
    const tH = theirsFiles.get(fp) || null;

    if (oH === tH) { if (oH) mergedFiles.push({ path: fp, hash: oH, mode: '100644' }); continue; }
    if (oH === bH) { if (tH) mergedFiles.push({ path: fp, hash: tH, mode: '100644' }); continue; }
    if (tH === bH) { if (oH) mergedFiles.push({ path: fp, hash: oH, mode: '100644' }); continue; }

    if (!oH || !tH) {
      const kept = oH || tH;
      conflicts.push({ path: fp, type: !oH ? 'delete-modify' : 'modify-delete', mergedContent: kept ? objects.readBlob(root, kept).toString('utf8') : '' });
      if (kept) mergedFiles.push({ path: fp, hash: kept, mode: '100644' });
      continue;
    }

    const baseContent = bH ? objects.readBlob(root, bH).toString('utf8') : '';
    const oursContent = objects.readBlob(root, oH).toString('utf8');
    const theirsContent = objects.readBlob(root, tH).toString('utf8');

    if (isBinary(baseContent) || isBinary(oursContent) || isBinary(theirsContent)) {
      conflicts.push({ path: fp, type: 'binary' });
      mergedFiles.push({ path: fp, hash: oH, mode: '100644' });
      continue;
    }

    const r = threeWayMerge(baseContent, oursContent, theirsContent);
    if (r.hasConflicts) {
      conflicts.push({ path: fp, type: 'content', mergedContent: r.merged, conflictCount: r.conflictCount });
    }
    const mergedHash = objects.createBlob(root, r.merged);
    mergedFiles.push({ path: fp, hash: mergedHash, mode: '100644' });
  }

  const mergedTreeHash = objects.buildTreeFromFiles(root, mergedFiles);
  return { hasConflicts: conflicts.length > 0, conflicts, mergedFiles, mergedTreeHash, base };
}

function manifestMap(entries: { path: string; hash: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) m.set(e.path, e.hash);
  return m;
}
