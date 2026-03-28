const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const REPOS_DIR = path.join(os.homedir(), 'vpshub-repos');

function ensureReposDir() {
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }
}

function getRepoPath(ownerUsername, repoSlug) {
  return path.join(REPOS_DIR, ownerUsername, `${repoSlug}.git`);
}

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (opts.gitDir) {
      env.GIT_DIR = opts.gitDir;
    }
    execFile('git', args, {
      cwd: opts.cwd,
      env,
      maxBuffer: 50 * 1024 * 1024,
      timeout: opts.timeout || 30000,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args[0]} failed: ${err.message}\n${stderr || ''}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ─── Repository CRUD ─────────────────────────────────────────

async function createRepository(pool, { ownerId, ownerUsername, name, slug, description, visibility, initReadme }) {
  ensureReposDir();

  const repoPath = getRepoPath(ownerUsername, slug);
  const ownerDir = path.dirname(repoPath);

  // Create owner dir if needed
  if (!fs.existsSync(ownerDir)) {
    fs.mkdirSync(ownerDir, { recursive: true });
  }

  // Init bare repo
  await git(['init', '--bare', repoPath]);

  // Set default branch to main
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { gitDir: repoPath });

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
    await initRepoWithReadme(repoPath, name, description, ownerUsername);
  }

  return repo;
}

async function initRepoWithReadme(repoPath, repoName, description, authorName) {
  // Use git plumbing to create initial commit in bare repo
  const readmeContent = `# ${repoName}\n\n${description || ''}\n`;

  // Create blob
  const blobHash = (await git(
    ['hash-object', '-w', '--stdin'],
    { gitDir: repoPath, cwd: repoPath }
  )).trim();

  // We need to pipe content, so use a temp file approach
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpshub-'));
  const tmpFile = path.join(tmpDir, 'README.md');
  fs.writeFileSync(tmpFile, readmeContent);

  try {
    // Hash the blob
    const hash = (await git(['hash-object', '-w', tmpFile], { gitDir: repoPath })).trim();

    // Create tree
    const treeInput = `100644 blob ${hash}\tREADME.md\n`;
    const treeFile = path.join(tmpDir, 'tree');
    fs.writeFileSync(treeFile, treeInput);

    const treeHash = (await git(['mktree'], { gitDir: repoPath, cwd: tmpDir })).trim();

    // For mktree we need to pipe - use a different approach
    // Actually let's use a temp worktree approach which is simpler
    const workDir = path.join(tmpDir, 'work');
    fs.mkdirSync(workDir);

    // Clone bare repo to temp, add file, push back
    await git(['clone', repoPath, workDir]);
    fs.writeFileSync(path.join(workDir, 'README.md'), readmeContent);
    await git(['add', 'README.md'], { cwd: workDir });
    await git([
      '-c', `user.name=${authorName}`,
      '-c', `user.email=${authorName}@vpshub`,
      'commit', '-m', 'Initial commit'
    ], { cwd: workDir });
    await git(['push', 'origin', 'HEAD:main'], { cwd: workDir });
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function deleteRepository(pool, repoId, ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);

  // Delete from DB
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

// ─── Git Read Operations ─────────────────────────────────────

async function getTree(ownerUsername, repoSlug, ref, dirPath) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  const target = dirPath ? `${ref}:${dirPath}` : `${ref}`;

  try {
    const output = await git(['ls-tree', '-l', target], { gitDir: repoPath });
    return output.trim().split('\n').filter(Boolean).map(line => {
      // format: <mode> <type> <hash> <size>\t<name>
      const match = line.match(/^(\d+)\s+(blob|tree)\s+([a-f0-9]+)\s+(-|\d+)\t(.+)$/);
      if (!match) return null;
      return {
        mode: match[1],
        type: match[2],
        hash: match[3],
        size: match[4] === '-' ? null : parseInt(match[4]),
        name: match[5],
        path: dirPath ? `${dirPath}/${match[5]}` : match[5],
      };
    }).filter(Boolean).sort((a, b) => {
      // Folders first, then files
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    if (err.message.includes('Not a valid object') || err.message.includes('fatal')) {
      return []; // Empty repo or invalid ref
    }
    throw err;
  }
}

async function getBlob(ownerUsername, repoSlug, ref, filePath) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const content = await git(['show', `${ref}:${filePath}`], { gitDir: repoPath });
    return content;
  } catch (err) {
    return null;
  }
}

async function getLog(ownerUsername, repoSlug, ref, { limit = 30, offset = 0, filePath } = {}) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  const format = '%H%n%h%n%an%n%ae%n%aI%n%s%n%b%n---COMMIT_END---';
  const args = ['log', `--format=${format}`, `--skip=${offset}`, `-n`, `${limit}`];

  if (ref) args.push(ref);
  if (filePath) {
    args.push('--');
    args.push(filePath);
  }

  try {
    const output = await git(args, { gitDir: repoPath });
    const commits = output.split('---COMMIT_END---').filter(s => s.trim()).map(block => {
      const lines = block.trim().split('\n');
      return {
        sha: lines[0],
        short_sha: lines[1],
        author_name: lines[2],
        author_email: lines[3],
        date: lines[4],
        message: lines[5],
        body: lines.slice(6).join('\n').trim(),
      };
    });
    return commits;
  } catch (err) {
    return []; // Empty repo
  }
}

async function getCommit(ownerUsername, repoSlug, sha) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  const format = '%H%n%h%n%an%n%ae%n%aI%n%P%n%s%n%b%n---END---';
  try {
    const output = await git(['show', `--format=${format}`, '--stat', sha], { gitDir: repoPath });
    const parts = output.split('---END---');
    const lines = parts[0].trim().split('\n');
    const stats = parts[1] ? parts[1].trim() : '';
    return {
      sha: lines[0],
      short_sha: lines[1],
      author_name: lines[2],
      author_email: lines[3],
      date: lines[4],
      parents: lines[5] ? lines[5].split(' ') : [],
      message: lines[6],
      body: lines.slice(7).join('\n').trim(),
      stats,
    };
  } catch {
    return null;
  }
}

async function getBranches(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const output = await git(['branch', '--list', '--format=%(refname:short)%09%(objectname:short)%09%(HEAD)'], { gitDir: repoPath });
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, sha, head] = line.split('\t');
      return { name, sha, isHead: head === '*' };
    });
  } catch {
    return [];
  }
}

async function getTags(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const output = await git(['tag', '--list', '--format=%(refname:short)%09%(objectname:short)'], { gitDir: repoPath });
    return output.trim().split('\n').filter(Boolean).map(line => {
      const [name, sha] = line.split('\t');
      return { name, sha };
    });
  } catch {
    return [];
  }
}

async function getDefaultBranch(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const output = await git(['symbolic-ref', '--short', 'HEAD'], { gitDir: repoPath });
    return output.trim();
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
    const output = await git(['rev-list', '--count', ref], { gitDir: repoPath });
    return parseInt(output.trim()) || 0;
  } catch {
    return 0;
  }
}

async function getDiff(ownerUsername, repoSlug, base, head) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const output = await git(['diff', `${base}...${head}`], { gitDir: repoPath });
    return output;
  } catch {
    return '';
  }
}

async function repoHasCommits(ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    await git(['rev-parse', 'HEAD'], { gitDir: repoPath });
    return true;
  } catch {
    return false;
  }
}

async function updateRepoSize(pool, repoId, ownerUsername, repoSlug) {
  const repoPath = getRepoPath(ownerUsername, repoSlug);
  try {
    const output = await git(['count-objects', '-v'], { gitDir: repoPath });
    const sizeMatch = output.match(/size-pack:\s*(\d+)/);
    const sizeKb = sizeMatch ? parseInt(sizeMatch[1]) : 0;
    await pool.query(
      'UPDATE vpshub_repositories SET size_bytes = $1 WHERE id = $2',
      [sizeKb * 1024, repoId]
    );
  } catch { /* ignore */ }
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
};
