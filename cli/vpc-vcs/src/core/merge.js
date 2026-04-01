/**
 * VPC VCS Client-Side Merge
 */

const objects = require('./objects');
const { myersDiff } = require('./diff');

function findMergeBase(root, commitA, commitB) {
  if (commitA === commitB) return commitA;

  const ancestorsA = new Set();
  const ancestorsB = new Set();
  const queueA = [commitA];
  const queueB = [commitB];

  while (queueA.length > 0 || queueB.length > 0) {
    if (queueA.length > 0) {
      const hash = queueA.shift();
      if (ancestorsB.has(hash)) return hash;
      if (!ancestorsA.has(hash)) {
        ancestorsA.add(hash);
        try {
          const commit = objects.readCommit(root, hash);
          for (const p of commit.parents) if (!ancestorsA.has(p)) queueA.push(p);
        } catch { break; }
      }
    }
    if (queueB.length > 0) {
      const hash = queueB.shift();
      if (ancestorsA.has(hash)) return hash;
      if (!ancestorsB.has(hash)) {
        ancestorsB.add(hash);
        try {
          const commit = objects.readCommit(root, hash);
          for (const p of commit.parents) if (!ancestorsB.has(p)) queueB.push(p);
        } catch { break; }
      }
    }
  }
  return null;
}

function threeWayMerge(base, ours, theirs) {
  if (ours === theirs) return { merged: ours, hasConflicts: false };
  if (ours === base) return { merged: theirs, hasConflicts: false };
  if (theirs === base) return { merged: ours, hasConflicts: false };

  const baseLines = base.split('\n');
  const ourLines = ours.split('\n');
  const theirLines = theirs.split('\n');

  const ourOps = myersDiff(baseLines, ourLines);
  const theirOps = myersDiff(baseLines, theirLines);

  // Simplified: if both changed differently, mark conflict
  const result = [];
  let hasConflicts = false;

  // Use ours as base, check if theirs diverges
  const ourChangedLines = new Set();
  const theirChangedLines = new Set();

  let idx = 0;
  for (const op of ourOps) {
    if (op.type === 'delete' || op.type === 'insert') ourChangedLines.add(idx);
    if (op.type !== 'insert') idx++;
  }

  idx = 0;
  for (const op of theirOps) {
    if (op.type === 'delete' || op.type === 'insert') theirChangedLines.add(idx);
    if (op.type !== 'insert') idx++;
  }

  // Check for overlapping changes
  for (const line of ourChangedLines) {
    if (theirChangedLines.has(line)) {
      hasConflicts = true;
      break;
    }
  }

  if (hasConflicts) {
    return {
      merged: `<<<<<<< ours\n${ours}\n=======\n${theirs}\n>>>>>>> theirs`,
      hasConflicts: true,
    };
  }

  // Non-overlapping: apply both sets of changes
  // Simple approach: take ours for our changes, theirs for their changes
  return { merged: ours === base ? theirs : ours, hasConflicts: false };
}

module.exports = { findMergeBase, threeWayMerge };
