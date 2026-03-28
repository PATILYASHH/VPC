const gitService = require('./vpshubGitService');

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

  // Perform git merge on the bare repo using a temp worktree
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { execFile } = require('child_process');

  function git(args, opts = {}) {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.gitDir ? { GIT_DIR: opts.gitDir } : {}) },
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpshub-merge-'));

  try {
    // Clone, checkout target, merge source
    await git(['clone', '--no-checkout', repoPath, tmpDir]);
    await git(['checkout', targetBranch], { cwd: tmpDir });
    await git([
      '-c', 'user.name=VPSHub',
      '-c', 'user.email=vpshub@localhost',
      'merge', '--no-ff', `origin/${sourceBranch}`,
      '-m', `Merge branch '${sourceBranch}' into ${targetBranch}`
    ], { cwd: tmpDir });

    const mergeSha = (await git(['rev-parse', 'HEAD'], { cwd: tmpDir })).trim();

    // Push merge commit back to bare repo
    await git(['push', 'origin', targetBranch], { cwd: tmpDir });

    // Update PR record
    await pool.query(
      `UPDATE vpshub_pull_requests
       SET status = 'merged', merged_by = $1, merged_at = NOW(), merge_commit_sha = $2, updated_at = NOW()
       WHERE id = $3`,
      [mergedById, mergeSha, prId]
    );

    return { success: true, merge_sha: mergeSha };
  } catch (err) {
    // Check if it's a merge conflict
    if (err.message.includes('CONFLICT') || err.message.includes('Automatic merge failed')) {
      return { success: false, error: 'Merge conflict detected. Resolve conflicts locally and push.' };
    }
    throw err;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  return gitService.getDiff(ownerUsername, repoSlug, targetBranch, sourceBranch);
}

async function getPrFiles(ownerUsername, repoSlug, sourceBranch, targetBranch) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);
  const { execFile } = require('child_process');

  return new Promise((resolve, reject) => {
    execFile('git', ['diff', '--name-status', `${targetBranch}...${sourceBranch}`], {
      env: { ...process.env, GIT_DIR: repoPath },
      maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const files = stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return { status: parts[0], path: parts[parts.length - 1] };
      });
      resolve(files);
    });
  });
}

async function getPrCommits(ownerUsername, repoSlug, sourceBranch, targetBranch) {
  const repoPath = gitService.getRepoPath(ownerUsername, repoSlug);
  const { execFile } = require('child_process');

  return new Promise((resolve, reject) => {
    const format = '%H%n%h%n%an%n%ae%n%aI%n%s%n---END---';
    execFile('git', ['log', `--format=${format}`, `${targetBranch}..${sourceBranch}`], {
      env: { ...process.env, GIT_DIR: repoPath },
      maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) { resolve([]); return; }
      const commits = stdout.split('---END---').filter(s => s.trim()).map(block => {
        const lines = block.trim().split('\n');
        return {
          sha: lines[0], short_sha: lines[1],
          author_name: lines[2], author_email: lines[3],
          date: lines[4], message: lines[5],
        };
      });
      resolve(commits);
    });
  });
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
};
