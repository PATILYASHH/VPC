/**
 * VPC VCS Merge Engine
 *
 * - Merge base finding (BFS on parent graph)
 * - Three-way merge at line level
 * - Conflict detection with markers
 * - Merge commit creation
 */

const vcsCore = require('./vpcVcsCore');
const vcsDiff = require('./vpcVcsDiff');

// ─── Merge Base ──────────────────────────────────────────────

/**
 * Find the merge base (lowest common ancestor) of two commits.
 * Uses BFS from both commits, looking for the first shared ancestor.
 *
 * @returns {string|null} merge base commit hash, or null if no common ancestor
 */
function findMergeBase(repoPath, commitA, commitB) {
  if (commitA === commitB) return commitA;

  const ancestorsA = new Set();
  const ancestorsB = new Set();
  const queueA = [commitA];
  const queueB = [commitB];

  // BFS alternating between both sides
  while (queueA.length > 0 || queueB.length > 0) {
    // Expand A
    if (queueA.length > 0) {
      const hash = queueA.shift();
      if (ancestorsB.has(hash)) return hash;
      if (!ancestorsA.has(hash)) {
        ancestorsA.add(hash);
        try {
          const commit = vcsCore.readCommit(repoPath, hash);
          for (const parent of commit.parents) {
            if (!ancestorsA.has(parent)) queueA.push(parent);
          }
        } catch { /* end of history */ }
      }
    }

    // Expand B
    if (queueB.length > 0) {
      const hash = queueB.shift();
      if (ancestorsA.has(hash)) return hash;
      if (!ancestorsB.has(hash)) {
        ancestorsB.add(hash);
        try {
          const commit = vcsCore.readCommit(repoPath, hash);
          for (const parent of commit.parents) {
            if (!ancestorsB.has(parent)) queueB.push(parent);
          }
        } catch { /* end of history */ }
      }
    }
  }

  return null; // No common ancestor (disconnected histories)
}

/**
 * Check if commitA is an ancestor of commitB
 */
function isAncestor(repoPath, commitA, commitB) {
  if (commitA === commitB) return true;

  const visited = new Set();
  const queue = [commitB];

  while (queue.length > 0) {
    const hash = queue.shift();
    if (hash === commitA) return true;
    if (visited.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = vcsCore.readCommit(repoPath, hash);
      for (const parent of commit.parents) {
        if (!visited.has(parent)) queue.push(parent);
      }
    } catch { break; }
  }

  return false;
}

// ─── Three-Way Merge ─────────────────────────────────────────

/**
 * Three-way merge of text content.
 * @param {string} base - common ancestor content
 * @param {string} ours - our version
 * @param {string} theirs - their version
 * @returns {{ merged: string, hasConflicts: boolean, conflictCount: number }}
 */
function threeWayMerge(base, ours, theirs) {
  // If ours equals theirs, no conflict
  if (ours === theirs) return { merged: ours, hasConflicts: false, conflictCount: 0 };
  // If ours equals base, take theirs (they changed, we didn't)
  if (ours === base) return { merged: theirs, hasConflicts: false, conflictCount: 0 };
  // If theirs equals base, take ours (we changed, they didn't)
  if (theirs === base) return { merged: ours, hasConflicts: false, conflictCount: 0 };

  // Both modified — need line-level merge
  const baseLines = base.split('\n');
  const ourLines = ours.split('\n');
  const theirLines = theirs.split('\n');

  const ourOps = vcsDiff.myersDiff(baseLines, ourLines);
  const theirOps = vcsDiff.myersDiff(baseLines, theirLines);

  // Build change maps: baseLineIdx → change
  const ourChanges = buildChangeMap(baseLines, ourOps);
  const theirChanges = buildChangeMap(baseLines, theirOps);

  const result = [];
  let hasConflicts = false;
  let conflictCount = 0;

  let baseIdx = 0;
  while (baseIdx <= baseLines.length) {
    const ourChange = ourChanges.get(baseIdx);
    const theirChange = theirChanges.get(baseIdx);

    if (!ourChange && !theirChange) {
      // No changes at this position — keep base line
      if (baseIdx < baseLines.length) {
        result.push(baseLines[baseIdx]);
      }
      baseIdx++;
    } else if (ourChange && !theirChange) {
      // Only we changed
      applyChange(result, ourChange, baseLines, baseIdx);
      baseIdx += ourChange.baseConsumed;
    } else if (!ourChange && theirChange) {
      // Only they changed
      applyChange(result, theirChange, baseLines, baseIdx);
      baseIdx += theirChange.baseConsumed;
    } else {
      // Both changed at same position
      if (ourChange.newLines.join('\n') === theirChange.newLines.join('\n')) {
        // Same change — no conflict
        applyChange(result, ourChange, baseLines, baseIdx);
        baseIdx += Math.max(ourChange.baseConsumed, theirChange.baseConsumed);
      } else {
        // Conflict!
        hasConflicts = true;
        conflictCount++;
        result.push('<<<<<<< ours');
        result.push(...ourChange.newLines);
        result.push('=======');
        result.push(...theirChange.newLines);
        result.push('>>>>>>> theirs');
        baseIdx += Math.max(ourChange.baseConsumed, theirChange.baseConsumed);
      }
    }
  }

  return {
    merged: result.join('\n'),
    hasConflicts,
    conflictCount,
  };
}

/**
 * Build a map of base line index → change description from diff operations
 */
function buildChangeMap(baseLines, ops) {
  const changes = new Map();
  let baseIdx = 0;
  let i = 0;

  while (i < ops.length) {
    const op = ops[i];

    if (op.type === 'equal') {
      baseIdx++;
      i++;
    } else {
      // Collect consecutive changes
      const newLines = [];
      let baseConsumed = 0;
      const startBaseIdx = baseIdx;

      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'insert') {
          newLines.push(ops[i].value);
        } else if (ops[i].type === 'delete') {
          baseConsumed++;
          baseIdx++;
        }
        i++;
      }

      // If there are inserted lines after deletions, include them
      changes.set(startBaseIdx, {
        newLines,
        baseConsumed: Math.max(baseConsumed, 1),
      });
    }
  }

  return changes;
}

function applyChange(result, change, baseLines, baseIdx) {
  for (const line of change.newLines) {
    result.push(line);
  }
}

// ─── Full Merge Operation ────────────────────────────────────

/**
 * Merge two branches (commit hashes) with a common base.
 * Operates directly on the bare repo object store.
 *
 * @returns {{ success: boolean, commitHash?: string, conflicts?: Array<{path: string, content: string}> }}
 */
function mergeCommits(repoPath, { ours, theirs, authorName, authorEmail, message }) {
  const mergeBase = findMergeBase(repoPath, ours, theirs);

  // Fast-forward case: if ours is ancestor of theirs
  if (mergeBase === ours) {
    return { success: true, commitHash: theirs, fastForward: true };
  }

  // Fast-forward case: if theirs is ancestor of ours (already up to date)
  if (mergeBase === theirs) {
    return { success: true, commitHash: ours, fastForward: true, alreadyUpToDate: true };
  }

  // Read the three trees
  const baseCommit = mergeBase ? vcsCore.readCommit(repoPath, mergeBase) : null;
  const oursCommit = vcsCore.readCommit(repoPath, ours);
  const theirsCommit = vcsCore.readCommit(repoPath, theirs);

  const baseTree = baseCommit ? baseCommit.tree : null;
  const oursTree = oursCommit.tree;
  const theirsTree = theirsCommit.tree;

  // Get file manifests
  const baseFiles = baseTree ? manifestToMap(vcsCore.walkTree(repoPath, baseTree)) : new Map();
  const oursFiles = manifestToMap(vcsCore.walkTree(repoPath, oursTree));
  const theirsFiles = manifestToMap(vcsCore.walkTree(repoPath, theirsTree));

  // Collect all file paths
  const allPaths = new Set([...baseFiles.keys(), ...oursFiles.keys(), ...theirsFiles.keys()]);

  const mergedFiles = [];
  const conflicts = [];

  for (const filePath of allPaths) {
    const baseHash = baseFiles.get(filePath) || null;
    const oursHash = oursFiles.get(filePath) || null;
    const theirsHash = theirsFiles.get(filePath) || null;

    // No change
    if (oursHash === theirsHash) {
      if (oursHash) mergedFiles.push({ path: filePath, hash: oursHash, mode: '100644' });
      continue;
    }

    // Only one side changed
    if (oursHash === baseHash) {
      // We didn't change, take theirs
      if (theirsHash) mergedFiles.push({ path: filePath, hash: theirsHash, mode: '100644' });
      // else: they deleted it
      continue;
    }
    if (theirsHash === baseHash) {
      // They didn't change, take ours
      if (oursHash) mergedFiles.push({ path: filePath, hash: oursHash, mode: '100644' });
      // else: we deleted it
      continue;
    }

    // Both sides modified (or one added, one deleted, etc.)
    if (!oursHash || !theirsHash) {
      // One deleted, other modified — conflict
      const kept = oursHash || theirsHash;
      conflicts.push({
        path: filePath,
        type: !oursHash ? 'delete-modify' : 'modify-delete',
        content: vcsCore.readBlob(repoPath, kept).toString('utf8'),
      });
      // Keep the existing version for now
      if (kept) mergedFiles.push({ path: filePath, hash: kept, mode: '100644' });
      continue;
    }

    // Both modified the same file — 3-way merge
    const baseContent = baseHash ? vcsCore.readBlob(repoPath, baseHash).toString('utf8') : '';
    const oursContent = vcsCore.readBlob(repoPath, oursHash).toString('utf8');
    const theirsContent = vcsCore.readBlob(repoPath, theirsHash).toString('utf8');

    // Check if binary
    if (vcsDiff.isBinaryContent(baseContent) || vcsDiff.isBinaryContent(oursContent) || vcsDiff.isBinaryContent(theirsContent)) {
      conflicts.push({ path: filePath, type: 'binary', content: '' });
      mergedFiles.push({ path: filePath, hash: oursHash, mode: '100644' }); // Keep ours for binary
      continue;
    }

    const mergeResult = threeWayMerge(baseContent, oursContent, theirsContent);

    if (mergeResult.hasConflicts) {
      conflicts.push({
        path: filePath,
        type: 'content',
        content: mergeResult.merged,
        conflictCount: mergeResult.conflictCount,
      });
    }

    // Store the merged content (with or without conflict markers)
    const mergedHash = vcsCore.createBlob(repoPath, mergeResult.merged);
    mergedFiles.push({ path: filePath, hash: mergedHash, mode: '100644' });
  }

  // Build the merged tree (always — even if conflicts exist, we store the merge with markers)
  const mergedTreeHash = vcsCore.buildTreeFromFiles(repoPath, mergedFiles);

  // Create merge commit with two parents
  const commitHash = vcsCore.createCommit(repoPath, {
    tree: mergedTreeHash,
    parents: [ours, theirs],
    authorName,
    authorEmail,
    message: conflicts.length > 0
      ? `${message || 'Merge branch'} [conflicts: ${conflicts.map(c => c.path).join(', ')}]`
      : (message || `Merge branch into ${ours.slice(0, 12)}`),
  });

  if (conflicts.length > 0) {
    return { success: false, commitHash, conflicts, mergedFiles };
  }

  return { success: true, commitHash, fastForward: false };
}

function manifestToMap(manifest) {
  const map = new Map();
  for (const entry of manifest) {
    map.set(entry.path, entry.hash);
  }
  return map;
}

/**
 * Get commits between two refs (commits in source not in target)
 * Used for PR commit lists
 */
function getCommitsBetween(repoPath, targetHash, sourceHash) {
  const targetAncestors = new Set();
  const queue = [targetHash];

  // Collect all target ancestors
  while (queue.length > 0) {
    const hash = queue.shift();
    if (!hash || targetAncestors.has(hash)) continue;
    targetAncestors.add(hash);
    try {
      const commit = vcsCore.readCommit(repoPath, hash);
      for (const parent of commit.parents) {
        queue.push(parent);
      }
    } catch { break; }
  }

  // Walk source commits, stop at target ancestors
  const commits = [];
  const visited = new Set();
  const sourceQueue = [sourceHash];

  while (sourceQueue.length > 0) {
    const hash = sourceQueue.shift();
    if (!hash || visited.has(hash) || targetAncestors.has(hash)) continue;
    visited.add(hash);

    try {
      const commit = vcsCore.readCommit(repoPath, hash);
      commits.push(commit);
      for (const parent of commit.parents) {
        if (!visited.has(parent) && !targetAncestors.has(parent)) {
          sourceQueue.push(parent);
        }
      }
    } catch { break; }
  }

  // Sort by date descending
  commits.sort((a, b) => (b.authorDate || 0) - (a.authorDate || 0));
  return commits;
}

module.exports = {
  findMergeBase,
  isAncestor,
  threeWayMerge,
  mergeCommits,
  getCommitsBetween,
};
