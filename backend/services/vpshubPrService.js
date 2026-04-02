/**
 * VPSHub Pull Request Service
 *
 * PR CRUD, merge, diff, comments — all using VPC VCS (no Git).
 */

const gitService = require('./vpshubGitService');
const vcsCore = require('./vpcVcsCore');
const vcsDiff = require('./vpcVcsDiff');
const vcsMerge = require('./vpcVcsMerge');

// ─── PR CRUD ──────────────────────────────────────────────────

async function getNextPrNumber(pool, repoId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(pr_number), 0) + 1 as next FROM vpshub_pull_requests WHERE repo_id = $1',
    [repoId]
  );
  return rows[0].next;
}

async function createPullRequest(pool, { repoId, title, description, sourceBranch, targetBranch, authorId }) {
  const prNumber = await getNextPrNumber(pool, repoId);

  const { rows } = await pool.query(
    `INSERT INTO vpshub_pull_requests (repo_id, pr_number, title, description, source_branch, target_branch, author_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [repoId, prNumber, title, description || '', sourceBranch, targetBranch || 'main', authorId]
  );
  return rows[0];
}

async function listPullRequests(pool, repoId, { status, limit = 30, offset = 0 } = {}) {
  let query = `
    SELECT pr.*, a.username as author_username, a.display_name as author_display_name,
           m.username as merged_by_username
    FROM vpshub_pull_requests pr
    JOIN vpc_admins a ON a.id = pr.author_id
    LEFT JOIN vpc_admins m ON m.id = pr.merged_by
    WHERE pr.repo_id = $1`;
  const params = [repoId];

  if (status && status !== 'all') {
    params.push(status);
    query += ` AND pr.status = $${params.length}`;
  }

  query += ` ORDER BY pr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await pool.query(query, params);

  // Get comment counts
  for (const pr of rows) {
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM vpshub_comments WHERE pr_id = $1', [pr.id]
    );
    pr.comment_count = parseInt(countResult.rows[0].count);
  }

  return rows;
}

async function getPullRequest(pool, repoId, prNumber) {
  const { rows } = await pool.query(
    `SELECT pr.*, a.username as author_username, a.display_name as author_display_name,
            m.username as merged_by_username
     FROM vpshub_pull_requests pr
     JOIN vpc_admins a ON a.id = pr.author_id
     LEFT JOIN vpc_admins m ON m.id = pr.merged_by
     WHERE pr.repo_id = $1 AND pr.pr_number = $2`,
    [repoId, prNumber]
  );
  return rows[0] || null;
}

async function getPrCount(pool, repoId, status) {
  let query = 'SELECT COUNT(*) as count FROM vpshub_pull_requests WHERE repo_id = $1';
  const params = [repoId];
  if (status && status !== 'all') {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  const { rows } = await pool.query(query, params);
  return parseInt(rows[0].count);
}

async function updatePullRequest(pool, prId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (['title', 'description', 'status'].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return null;
  fields.push('updated_at = NOW()');
  values.push(prId);

  const { rows } = await pool.query(
    `UPDATE vpshub_pull_requests SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

// ─── Merge ────────────────────────────────────────────────────

async function mergePullRequest(pool, { prId, repoId, ownerUsername, repoSlug, sourceBranch, targetBranch, mergedById }) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);

  // Resolve both branches to commit hashes
  const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${sourceBranch}`);
  const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${targetBranch}`);

  if (!sourceHash) {
    return { success: false, error: `Branch '${sourceBranch}' not found` };
  }
  if (!targetHash) {
    return { success: false, error: `Branch '${targetBranch}' not found` };
  }

  // Perform merge using VCS merge engine
  const result = vcsMerge.mergeCommits(repoPath, {
    ours: targetHash,
    theirs: sourceHash,
    authorName: 'VPSHub',
    authorEmail: 'vpshub@localhost',
    message: `Merge branch '${sourceBranch}' into ${targetBranch}`,
  });

  if (!result.success) {
    const conflictPaths = result.conflicts.map(c => c.path).join(', ');
    return { success: false, error: `Merge conflict in: ${conflictPaths}. Resolve conflicts locally and push.` };
  }

  const mergeSha = result.commitHash;

  // Update the target branch ref
  vcsCore.updateRef(repoPath, `refs/heads/${targetBranch}`, mergeSha);

  // Sync refs and commits to DB
  await vcsCore.syncRefsToDb(pool, repoId, repoPath);
  await vcsCore.syncCommitsToDb(pool, repoId, repoPath, mergeSha);

  // Update PR record
  await pool.query(
    `UPDATE vpshub_pull_requests
     SET status = 'merged', merged_by = $1, merged_at = NOW(), merge_commit_sha = $2, updated_at = NOW()
     WHERE id = $3`,
    [mergedById, mergeSha, prId]
  );

  return { success: true, merge_sha: mergeSha };
}

async function closePullRequest(pool, prId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_pull_requests SET status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [prId]
  );
  return rows[0];
}

async function reopenPullRequest(pool, prId) {
  const { rows } = await pool.query(
    `UPDATE vpshub_pull_requests SET status = 'open', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [prId]
  );
  return rows[0];
}

// ─── PR Diff ──────────────────────────────────────────────────

async function getPrDiff(ownerUsername, repoSlug, sourceBranch, targetBranch) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);

  const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${sourceBranch}`);
  const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${targetBranch}`);
  if (!sourceHash || !targetHash) return '';

  // Diff from merge-base to source (like git diff target...source)
  const mergeBase = vcsMerge.findMergeBase(repoPath, targetHash, sourceHash);
  const fromHash = mergeBase || targetHash;

  return vcsDiff.diffCommits(repoPath, fromHash, sourceHash);
}

async function getPrFiles(ownerUsername, repoSlug, sourceBranch, targetBranch) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);

  const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${sourceBranch}`);
  const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${targetBranch}`);
  if (!sourceHash || !targetHash) return [];

  const mergeBase = vcsMerge.findMergeBase(repoPath, targetHash, sourceHash);
  const fromHash = mergeBase || targetHash;

  const fromCommit = vcsCore.readCommit(repoPath, fromHash);
  const toCommit = vcsCore.readCommit(repoPath, sourceHash);

  const changes = vcsDiff.diffTrees(repoPath, fromCommit.tree, toCommit.tree);
  return changes.map(c => ({ status: c.status, path: c.path }));
}

async function getPrCommits(ownerUsername, repoSlug, sourceBranch, targetBranch) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);

  const sourceHash = vcsCore.resolveRef(repoPath, `refs/heads/${sourceBranch}`);
  const targetHash = vcsCore.resolveRef(repoPath, `refs/heads/${targetBranch}`);
  if (!sourceHash || !targetHash) return [];

  const commits = vcsMerge.getCommitsBetween(repoPath, targetHash, sourceHash);

  return commits.map(c => ({
    sha: c.hash,
    short_sha: c.hash.slice(0, 12),
    author_name: c.authorName,
    author_email: c.authorEmail,
    date: c.authorDate ? new Date(c.authorDate * 1000).toISOString() : null,
    message: c.message,
  }));
}

// ─── Comments ─────────────────────────────────────────────────

async function addComment(pool, { repoId, prId, issueId, authorId, body, filePath, lineNumber }) {
  const { rows } = await pool.query(
    `INSERT INTO vpshub_comments (repo_id, pr_id, issue_id, author_id, body, file_path, line_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [repoId, prId || null, issueId || null, authorId, body, filePath || null, lineNumber || null]
  );
  return rows[0];
}

async function getComments(pool, { prId, issueId }) {
  const field = prId ? 'pr_id' : 'issue_id';
  const value = prId || issueId;

  const { rows } = await pool.query(
    `SELECT c.*, a.username as author_username, a.display_name as author_display_name
     FROM vpshub_comments c
     JOIN vpc_admins a ON a.id = c.author_id
     WHERE c.${field} = $1
     ORDER BY c.created_at ASC`,
    [value]
  );
  return rows;
}

async function deleteComment(pool, commentId, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM vpshub_comments WHERE id = $1 AND author_id = $2',
    [commentId, userId]
  );
  return rowCount > 0;
}

async function updateComment(pool, commentId, userId, body) {
  const { rows } = await pool.query(
    `UPDATE vpshub_comments SET body = $1, updated_at = NOW()
     WHERE id = $2 AND author_id = $3 RETURNING *`,
    [body, commentId, userId]
  );
  return rows[0] || null;
}

// ─── Apply AI-resolved files to source branch ───────────────

async function applyResolvedFiles(pool, { repoId, repoPath, sourceBranch, resolvedFiles, authorName }) {
  const sourceRef = `refs/heads/${sourceBranch}`;
  const sourceHash = vcsCore.resolveRef(repoPath, sourceRef);
  if (!sourceHash) throw new Error(`Branch '${sourceBranch}' not found`);

  // Read current commit and its tree
  const commit = vcsCore.readCommit(repoPath, sourceHash);
  const currentFiles = vcsCore.walkTree(repoPath, commit.tree);

  // Build new file list with resolved content replacing conflicted files
  const resolvedMap = new Map(resolvedFiles.map(f => [f.path, f.content]));
  const newFiles = [];

  for (const file of currentFiles) {
    if (resolvedMap.has(file.path)) {
      // Replace with AI-resolved content
      const content = resolvedMap.get(file.path);
      const newHash = vcsCore.createBlob(repoPath, content);
      newFiles.push({ path: file.path, hash: newHash, mode: file.mode || '100644' });
      resolvedMap.delete(file.path);
    } else {
      newFiles.push(file);
    }
  }

  // Add any new files from resolutions that weren't in the tree
  for (const [path, content] of resolvedMap) {
    const newHash = vcsCore.createBlob(repoPath, content);
    newFiles.push({ path, hash: newHash, mode: '100644' });
  }

  // Build new tree and commit
  const newTreeHash = vcsCore.buildTreeFromFiles(repoPath, newFiles);
  const newCommitHash = vcsCore.createCommit(repoPath, {
    tree: newTreeHash,
    parents: [sourceHash],
    authorName: authorName || 'VPAI',
    authorEmail: `${(authorName || 'vpai').toLowerCase().replace(/\s/g, '')}@vpshub`,
    message: `VPAI: Auto-resolve ${resolvedFiles.length} conflict(s)`,
  });

  // Update source branch ref
  vcsCore.updateRef(repoPath, sourceRef, newCommitHash);

  // Sync to DB
  await vcsCore.syncRefsToDb(pool, repoId, repoPath);
  await vcsCore.syncCommitsToDb(pool, repoId, repoPath, newCommitHash);

  return { commitHash: newCommitHash };
}

module.exports = {
  createPullRequest,
  listPullRequests,
  getPullRequest,
  getPrCount,
  updatePullRequest,
  mergePullRequest,
  closePullRequest,
  reopenPullRequest,
  getPrDiff,
  getPrFiles,
  getPrCommits,
  addComment,
  getComments,
  deleteComment,
  updateComment,
  applyResolvedFiles,
};
