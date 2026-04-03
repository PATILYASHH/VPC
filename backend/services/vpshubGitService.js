/**
 * VPSHub Repository Service
 *
 * Provides all repository operations using VPC VCS (custom version control).
 * No Git dependency — all operations use vpcVcsCore, vpcVcsDiff, vpcVcsMerge.
 *
 * Exported API signatures are preserved for compatibility with existing routes.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const vcsCore = require('./vpcVcsCore');
const vcsDiff = require('./vpcVcsDiff');
const vcsMerge = require('./vpcVcsMerge');

const REPOS_DIR = path.join(os.homedir(), 'vpshub-repos');

function ensureReposDir() {
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
}

function getRepoPath(ownerUsername, repoSlug) {
  // Check for both .vpc and .git extensions (legacy repos use .git)
  const vpcPath = path.join(REPOS_DIR, ownerUsername, `${repoSlug}.vpc`);
  const gitPath = path.join(REPOS_DIR, ownerUsername, `${repoSlug}.git`);
  if (fs.existsSync(gitPath)) return gitPath;
  return vpcPath;
}

// ─── Repository CRUD ─────────────────────────────────────────

async function createRepository(pool, { ownerId, ownerUsername, name, slug, description, visibility, initReadme }) {
  ensureReposDir();

  const repoPath = getRepoPath(ownerUsername, slug);
  const ownerDir = path.dirname(repoPath);

  if (!fs.existsSync(ownerDir)) {
    fs.mkdirSync(ownerDir, { recursive: true });
  }

  // Init bare VPC VCS repo
  vcsCore.initBareRepo(repoPath);

  // Insert DB record
  const { rows } = await pool.query(
    `INSERT INTO vpshub_repositories (owner_id, name, slug, description, visibility)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [ownerId, name, slug, description || '', visibility || 'private']
  );

  const repo = rows[0];

  // Initialize with README if requested
  if (initReadme) {
    const commitHash = vcsCore.initRepoWithReadme(repoPath, name, description, ownerUsername);

    // Sync to DB
    await vcsCore.syncRefsToDb(pool, repo.id, repoPath);
    await vcsCore.syncCommitsToDb(pool, repo.id, repoPath, commitHash);
  }

  return repo;
}

async function deleteRepository(pool, repoId, ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);

  // Delete from DB (cascades to refs, commits, PRs, etc.)
  await pool.query('DELETE FROM vpshub_repositories WHERE id = $1', [repoId]);

  // Delete from filesystem
  if (fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
}

async function getRepositories(pool, ownerId) {
  const { rows } = await pool.query(
    `SELECT r.*, a.username as owner_username, a.display_name as owner_display_name
     FROM vpshub_repositories r
     JOIN vpc_admins a ON a.id = r.owner_id
     WHERE r.owner_id = $1
     ORDER BY r.updated_at DESC`,
    [ownerId]
  );
  return rows;
}

async function getAllRepositories(pool) {
  const { rows } = await pool.query(
    `SELECT r.*, a.username as owner_username, a.display_name as owner_display_name
     FROM vpshub_repositories r
     JOIN vpc_admins a ON a.id = r.owner_id
     ORDER BY r.updated_at DESC`
  );
  return rows;
}

async function getRepositoryBySlug(pool, ownerUsername, slug) {
  const { rows } = await pool.query(
    `SELECT r.*, a.username as owner_username, a.display_name as owner_display_name
     FROM vpshub_repositories r
     JOIN vpc_admins a ON a.id = r.owner_id
     WHERE a.username = $1 AND r.slug = $2`,
    [ownerUsername, slug]
  );
  return rows[0] || null;
}

async function getRepositoryById(pool, repoId) {
  const { rows } = await pool.query(
    `SELECT r.*, a.username as owner_username, a.display_name as owner_display_name
     FROM vpshub_repositories r
     JOIN vpc_admins a ON a.id = r.owner_id
     WHERE r.id = $1`,
    [repoId]
  );
  return rows[0] || null;
}

async function updateRepository(pool, repoId, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (['name', 'description', 'visibility', 'default_branch'].includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(repoId);

  const { rows } = await pool.query(
    `UPDATE vpshub_repositories SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

// ─── VCS Read Operations ─────────────────────────────────────

async function getTree(ownerUsername, repoSlug, ref, dirPath) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);

  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return [];

    const commit = vcsCore.readCommit(repoPath, commitHash);

    // Resolve the directory path within the tree
    let treeHash = commit.tree;
    if (dirPath) {
      const resolved = vcsCore.resolveTreePath(repoPath, commit.tree, dirPath);
      if (!resolved || resolved.type !== 'tree') return [];
      treeHash = resolved.hash;
    }

    const entries = vcsCore.readTree(repoPath, treeHash);

    // Add size info for blobs
    return entries.map(entry => {
      let size = null;
      if (entry.type === 'blob') {
        try {
          const blob = vcsCore.readBlob(repoPath, entry.hash);
          size = blob.length;
        } catch { /* ignore */ }
      }

      return {
        mode: entry.mode,
        type: entry.type,
        hash: entry.hash,
        size,
        name: entry.name,
        path: dirPath ? `${dirPath}/${entry.name}` : entry.name,
      };
    }).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    return [];
  }
}

async function getBlob(ownerUsername, repoSlug, ref, filePath) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return null;

    const commit = vcsCore.readCommit(repoPath, commitHash);
    const resolved = vcsCore.resolveTreePath(repoPath, commit.tree, filePath);
    if (!resolved || resolved.type !== 'blob') return null;

    return vcsCore.readBlob(repoPath, resolved.hash).toString('utf8');
  } catch {
    return null;
  }
}

async function getBlobRaw(ownerUsername, repoSlug, ref, filePath) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return null;

    const commit = vcsCore.readCommit(repoPath, commitHash);
    const resolved = vcsCore.resolveTreePath(repoPath, commit.tree, filePath);
    if (!resolved || resolved.type !== 'blob') return null;

    return vcsCore.readBlob(repoPath, resolved.hash); // Returns Buffer
  } catch {
    return null;
  }
}

async function getLog(ownerUsername, repoSlug, ref, { limit = 30, offset = 0, filePath } = {}) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);

  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return [];

    let commits = vcsCore.walkCommits(repoPath, commitHash, { limit: limit + offset, offset: 0 });

    // If filtering by file path, only include commits that changed the file
    if (filePath) {
      commits = commits.filter(commit => {
        try {
          for (const parentHash of commit.parents) {
            const parentCommit = vcsCore.readCommit(repoPath, parentHash);
            const changes = vcsDiff.diffTrees(repoPath, parentCommit.tree, commit.tree);
            if (changes.some(c => c.path === filePath)) return true;
          }
          // Root commit — check if file exists in tree
          if (commit.parents.length === 0) {
            const manifest = vcsCore.walkTree(repoPath, commit.tree);
            return manifest.some(f => f.path === filePath);
          }
          return false;
        } catch { return false; }
      });
    }

    // Apply offset and limit
    commits = commits.slice(offset, offset + limit);

    return commits.map(c => ({
      sha: c.hash,
      short_sha: c.hash.slice(0, 12),
      author_name: c.authorName,
      author_email: c.authorEmail,
      date: c.authorDate ? new Date(c.authorDate * 1000).toISOString() : null,
      message: c.message,
      body: c.body || '',
    }));
  } catch {
    return [];
  }
}

async function getCommit(ownerUsername, repoSlug, sha) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const commitHash = vcsCore.resolveRef(repoPath, sha);
    if (!commitHash) return null;

    const commit = vcsCore.readCommit(repoPath, commitHash);

    // Get stats (compare with first parent)
    let stats = '';
    if (commit.parents.length > 0) {
      const parentCommit = vcsCore.readCommit(repoPath, commit.parents[0]);
      const changes = vcsDiff.diffTrees(repoPath, parentCommit.tree, commit.tree);
      stats = vcsDiff.formatDiffStats(repoPath, changes);
    } else {
      const changes = vcsDiff.diffTrees(repoPath, null, commit.tree);
      stats = vcsDiff.formatDiffStats(repoPath, changes);
    }

    return {
      sha: commit.hash,
      short_sha: commit.hash.slice(0, 12),
      author_name: commit.authorName,
      author_email: commit.authorEmail,
      date: commit.authorDate ? new Date(commit.authorDate * 1000).toISOString() : null,
      parents: commit.parents,
      message: commit.message,
      body: commit.body || '',
      stats,
    };
  } catch {
    return null;
  }
}

async function getBranches(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const refs = vcsCore.listRefs(repoPath, 'refs/heads/');
    const head = vcsCore.readHead(repoPath);
    const headRef = head.symbolic ? head.ref : null;

    return refs.map(ref => ({
      name: ref.name.replace('refs/heads/', ''),
      sha: ref.hash.slice(0, 12),
      isHead: ref.name === headRef,
    }));
  } catch {
    return [];
  }
}

async function getTags(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const refs = vcsCore.listRefs(repoPath, 'refs/tags/');
    return refs.map(ref => ({
      name: ref.name.replace('refs/tags/', ''),
      sha: ref.hash.slice(0, 12),
    }));
  } catch {
    return [];
  }
}

async function getDefaultBranch(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const head = vcsCore.readHead(repoPath);
    if (head.symbolic && head.ref) {
      return head.ref.replace('refs/heads/', '');
    }
    return 'main';
  } catch {
    return 'main';
  }
}

async function getReadme(ownerUsername, repoSlug, ref) {
  const tree = await getTree(ownerUsername, repoSlug, ref, '');
  const readmeFile = tree.find(f =>
    f.type === 'blob' && /^readme(\.(md|txt|rst))?$/i.test(f.name)
  );
  if (!readmeFile) return null;

  const content = await getBlob(ownerUsername, repoSlug, ref, readmeFile.name);
  return { name: readmeFile.name, content };
}

async function getCommitCount(ownerUsername, repoSlug, ref) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return 0;
    return vcsCore.countCommits(repoPath, commitHash);
  } catch {
    return 0;
  }
}

async function getDiff(ownerUsername, repoSlug, base, head) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const baseHash = vcsCore.resolveRef(repoPath, base);
    const headHash = vcsCore.resolveRef(repoPath, head);
    if (!baseHash || !headHash) return '';

    // Use three-dot diff semantics: diff from merge-base to head
    const mergeBase = vcsMerge.findMergeBase(repoPath, baseHash, headHash);
    const fromHash = mergeBase || baseHash;

    return vcsDiff.diffCommits(repoPath, fromHash, headHash);
  } catch {
    return '';
  }
}

async function repoHasCommits(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const hash = vcsCore.resolveRef(repoPath, 'HEAD');
    return !!hash;
  } catch {
    return false;
  }
}

async function updateRepoSize(pool, repoId, ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const sizeBytes = vcsCore.getRepoObjectsSize(repoPath);
    await pool.query(
      'UPDATE vpshub_repositories SET size_bytes = $1 WHERE id = $2',
      [sizeBytes, repoId]
    );
  } catch { /* ignore */ }
}

// ─── Full File Manifest (for extension sync) ────────────────

async function getFileManifest(ownerUsername, repoSlug, ref) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const commitHash = vcsCore.resolveRef(repoPath, ref || 'HEAD');
    if (!commitHash) return [];

    const commit = vcsCore.readCommit(repoPath, commitHash);
    return vcsCore.walkTree(repoPath, commit.tree);
  } catch {
    return [];
  }
}

async function getHeadSha(ownerUsername, repoSlug, ref) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    return vcsCore.resolveRef(repoPath, ref || 'HEAD');
  } catch {
    return null;
  }
}

async function getChangedFiles(ownerUsername, repoSlug, fromSha, toSha) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const fromHash = vcsCore.resolveRef(repoPath, fromSha);
    const toHash = vcsCore.resolveRef(repoPath, toSha);
    if (!fromHash || !toHash) return [];

    const fromCommit = vcsCore.readCommit(repoPath, fromHash);
    const toCommit = vcsCore.readCommit(repoPath, toHash);

    const changes = vcsDiff.diffTrees(repoPath, fromCommit.tree, toCommit.tree);
    return changes.map(c => ({
      status: c.status,
      path: c.path,
    }));
  } catch {
    return [];
  }
}

// ─── Upload Files & Commit ──────────────────────────────────

/**
 * Upload multiple files to a repo branch and create a commit.
 * Files are provided as an array of { path, content (Buffer) }.
 * If the branch already has commits, new files are merged into the existing tree.
 *
 * @param {object} pool - DB pool
 * @param {number} repoId - repo DB id
 * @param {string} ownerUsername
 * @param {string} repoSlug
 * @param {string} branch - target branch (e.g. 'main')
 * @param {Array<{path: string, content: Buffer}>} files - files to add
 * @param {string} commitMessage
 * @param {string} authorName
 * @returns {{ commitHash: string, filesCount: number }}
 */
async function uploadFiles(pool, repoId, ownerUsername, repoSlug, branch, files, commitMessage, authorName) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);

  // Create blobs for each file
  const fileEntries = files.map(f => {
    const blobHash = vcsCore.createBlob(repoPath, f.content);
    return { path: f.path, hash: blobHash, mode: '100644' };
  });

  // Get existing tree entries if branch has commits
  let existingFiles = [];
  const parentHash = vcsCore.resolveRef(repoPath, `refs/heads/${branch}`) ||
                     vcsCore.resolveRef(repoPath, 'HEAD');

  if (parentHash) {
    try {
      const parentCommit = vcsCore.readCommit(repoPath, parentHash);
      existingFiles = vcsCore.walkTree(repoPath, parentCommit.tree);
    } catch { /* empty repo */ }
  }

  // Merge: new files override existing ones at same path
  const newPaths = new Set(fileEntries.map(f => f.path));
  const mergedFiles = [
    ...existingFiles.filter(f => !newPaths.has(f.path)),
    ...fileEntries,
  ];

  // Build tree and commit
  const treeHash = vcsCore.buildTreeFromFiles(repoPath, mergedFiles);
  const parents = parentHash ? [parentHash] : [];

  const commitHash = vcsCore.createCommit(repoPath, {
    tree: treeHash,
    parents,
    authorName,
    authorEmail: `${authorName}@vpshub`,
    message: commitMessage || `Upload ${files.length} file(s)`,
  });

  // Update branch ref
  vcsCore.updateRef(repoPath, `refs/heads/${branch}`, commitHash);

  // Sync to DB (skip if tables don't exist)
  try { await vcsCore.syncRefsToDb(pool, repoId, repoPath); } catch { /* table may not exist */ }
  try { await vcsCore.syncCommitsToDb(pool, repoId, repoPath, commitHash); } catch { /* table may not exist */ }
  await updateRepoSize(pool, repoId, ownerUsername, repoSlug);

  return { commitHash, filesCount: files.length };
}

/**
 * Smart upload: compare uploaded files against current branch,
 * detect what changed, and show a diff summary.
 * Returns { newFiles, modifiedFiles, unchangedFiles, deletedFiles }
 */
function previewUpload(ownerUsername, repoSlug, branch, uploadedFiles) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  const refHash = vcsCore.resolveRef(repoPath, `refs/heads/${branch}`) ||
                  vcsCore.resolveRef(repoPath, 'HEAD');

  const existingMap = new Map();
  if (refHash) {
    try {
      const commit = vcsCore.readCommit(repoPath, refHash);
      const files = vcsCore.walkTree(repoPath, commit.tree);
      for (const f of files) existingMap.set(f.path, f.hash);
    } catch { /* empty repo */ }
  }

  const newFiles = [];
  const modifiedFiles = [];
  const unchangedFiles = [];

  for (const file of uploadedFiles) {
    const uploadHash = vcsCore.hashObject('blob', file.content);
    const existingHash = existingMap.get(file.path);

    if (!existingHash) {
      newFiles.push(file.path);
    } else if (existingHash !== uploadHash) {
      modifiedFiles.push(file.path);
    } else {
      unchangedFiles.push(file.path);
    }
  }

  return {
    newFiles,
    modifiedFiles,
    unchangedFiles,
    totalExisting: existingMap.size,
    currentCommit: refHash,
  };
}

/**
 * Track when a user downloads a repo snapshot.
 * Used later to detect what changed on server since their download.
 */
async function trackDownload(pool, repoId, userId, branch, commitHash) {
  try {
    await pool.query(`
      INSERT INTO vpshub_user_downloads (repo_id, user_id, branch, commit_hash, downloaded_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (repo_id, user_id, branch)
      DO UPDATE SET commit_hash = $4, downloaded_at = NOW()
    `, [repoId, userId, branch, commitHash]);
  } catch { /* table may not exist yet */ }
}

/**
 * Get the last download info for a user on a repo/branch.
 */
async function getLastDownload(pool, repoId, userId, branch) {
  try {
    const { rows } = await pool.query(
      `SELECT commit_hash, downloaded_at FROM vpshub_user_downloads
       WHERE repo_id = $1 AND user_id = $2 AND branch = $3`,
      [repoId, userId, branch]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

module.exports = {
  REPOS_DIR,
  getRepoPath,
  createRepository,
  deleteRepository,
  getRepositories,
  getAllRepositories,
  getRepositoryBySlug,
  getRepositoryById,
  updateRepository,
  getTree,
  getBlob,
  getBlobRaw,
  getLog,
  getCommit,
  getBranches,
  getTags,
  getDefaultBranch,
  getReadme,
  getCommitCount,
  getDiff,
  repoHasCommits,
  updateRepoSize,
  getFileManifest,
  getHeadSha,
  getChangedFiles,
  uploadFiles,
  previewUpload,
  trackDownload,
  getLastDownload,
};
