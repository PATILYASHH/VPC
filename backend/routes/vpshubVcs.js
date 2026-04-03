/**
 * VPC VCS Transfer Protocol
 *
 * Custom HTTP push/pull protocol replacing Git Smart HTTP.
 * Uses VPCPACK binary format for object transfer.
 *
 * Endpoints:
 *   POST /vcs/:owner/:repo/refs      — List remote refs
 *   POST /vcs/:owner/:repo/negotiate  — Object negotiation
 *   POST /vcs/:owner/:repo/push       — Upload objects + update refs
 *   POST /vcs/:owner/:repo/pull       — Download missing objects
 */

const express = require('express');
const zlib = require('zlib');
const router = express.Router();
const { getRepoPath } = require('../services/vpshubGitService');
const vcsCore = require('../services/vpcVcsCore');
const vcsMerge = require('../services/vpcVcsMerge');
const { authenticateGitRequest, checkRepoAccess } = require('../services/vpshubAuthService');

// ─── Middleware ───────────────────────────────────────────────

// Parse raw binary body for push/pull
router.use(express.raw({ type: 'application/x-vpc-pack', limit: '200mb' }));
// Parse JSON body for refs/negotiate
router.use(express.json({ limit: '10mb' }));

async function resolveRepo(req, res, next) {
  try {
    const { owner, repo } = req.params;
    const repoSlug = repo.replace(/\.vpc$/, '');
    const pool = req.app.locals.pool;

    const { rows } = await pool.query(
      `SELECT r.*, a.username as owner_username
       FROM vpshub_repositories r
       JOIN vpc_admins a ON a.id = r.owner_id
       WHERE a.username = $1 AND r.slug = $2`,
      [owner, repoSlug]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    req.repoInfo = rows[0];
    req.repoPath = getRepoPath(owner, repoSlug);
    next();
  } catch (err) {
    console.error('[VPC VCS] resolveRepo error:', err.message);
    res.status(500).json({ error: 'Failed to resolve repository' });
  }
}

async function authenticateVcs(req, res, next) {
  try {
    const pool = req.app.locals.pool;
    const authHeader = req.headers.authorization;

    const isRead = req.path.includes('/refs') || req.path.includes('/pull');

    // Public repos allow read without auth
    if (req.repoInfo.visibility === 'public' && isRead) {
      req.vcsUser = null;
      return next();
    }

    const user = await authenticateGitRequest(pool, authHeader);
    if (!user) {
      res.setHeader('WWW-Authenticate', 'Basic realm="VPSHub"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const requiredPerm = isRead ? 'read' : 'write';
    const hasAccess = await checkRepoAccess(pool, user.userId, req.repoInfo.id, requiredPerm);

    if (!hasAccess && req.repoInfo.owner_id !== user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    req.vcsUser = user;
    next();
  } catch (err) {
    console.error('[VPC VCS] authenticateVcs error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// ─── List Refs ───────────────────────────────────────────────

router.post('/:owner/:repo/refs', resolveRepo, authenticateVcs, (req, res) => {
  try {
    const refs = vcsCore.listRefs(req.repoPath, 'refs/');
    const head = vcsCore.readHead(req.repoPath);
    let headHash = null;

    if (head.symbolic) {
      headHash = vcsCore.resolveRef(req.repoPath, head.ref);
    } else {
      headHash = head.hash;
    }

    const refMap = {};
    for (const ref of refs) {
      refMap[ref.name] = ref.hash;
    }

    res.json({
      HEAD: headHash,
      defaultBranch: head.symbolic ? head.ref.replace('refs/heads/', '') : 'main',
      refs: refMap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Negotiate ───────────────────────────────────────────────

router.post('/:owner/:repo/negotiate', resolveRepo, authenticateVcs, (req, res) => {
  try {
    const { operation, haves = [], wants = [], refs: refUpdates } = req.body;

    const haveSet = new Set(haves);

    if (operation === 'push') {
      // Client wants to push — figure out which objects we need
      const needs = new Set();

      for (const [refName, { old: oldHash, new: newHash }] of Object.entries(refUpdates || {})) {
        // Force-push: never reject at negotiate stage — push handler handles divergence
        // Just collect what objects the server needs
        if (newHash) {
          needs.add(newHash);
        }
      }

      res.json({ ok: true, needs: [...needs] });

    } else if (operation === 'pull') {
      // Client wants to pull — figure out which objects to send
      const wantHashes = [];

      for (const want of wants) {
        // Resolve ref name to hash
        const hash = vcsCore.resolveRef(req.repoPath, want);
        if (hash) wantHashes.push(hash);
      }

      // Collect all reachable objects from wanted commits, excluding what client has
      const objectsToSend = new Set();
      for (const wantHash of wantHashes) {
        const reachable = vcsCore.collectReachableObjects(req.repoPath, wantHash, haveSet);
        for (const hash of reachable) {
          if (!haveSet.has(hash)) {
            objectsToSend.add(hash);
          }
        }
      }

      // Get current refs
      const refs = {};
      for (const want of wants) {
        const hash = vcsCore.resolveRef(req.repoPath, want);
        if (hash) refs[want] = hash;
      }

      res.json({
        refs,
        objectCount: objectsToSend.size,
        objects: [...objectsToSend],
      });

    } else {
      res.status(400).json({ error: 'Invalid operation. Use "push" or "pull".' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Push (receive objects + update refs) ────────────────────
// Smart push: fast-forward → auto-merge → auto-PR on conflict

router.post('/:owner/:repo/push', resolveRepo, authenticateVcs, async (req, res) => {
  try {
    const fs = require('fs');
    const pathMod = require('path');
    const contentType = req.headers['content-type'] || '';
    let objectData, refUpdates;

    if (contentType.includes('application/x-vpc-pack')) {
      const parsed = parsePack(req.body);
      objectData = parsed.objects;
      refUpdates = parsed.refs;
    } else {
      objectData = req.body.objects || [];
      refUpdates = req.body.refs || {};
    }

    // Store objects (skip existing for idempotency)
    for (const obj of objectData) {
      if (vcsCore.objectExists(req.repoPath, obj.hash)) continue;
      const objPath = vcsCore.objectPath(req.repoPath, obj.hash);
      const dir = pathMod.dirname(objPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (obj.compressed) {
        fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
      } else {
        const compressed = zlib.deflateSync(Buffer.from(obj.data, 'base64'));
        fs.writeFileSync(objPath, compressed);
      }
    }

    // Update refs with smart merge
    const pool = req.app.locals.pool;
    const updatedRefs = {};
    let autoMerged = false;
    let autoMergeNotifications = null;

    for (const [refName, update] of Object.entries(refUpdates)) {
      // Validate refName to prevent path traversal
      if (!/^refs\/[a-zA-Z0-9_\-\/.]+$/.test(refName)) {
        return res.status(400).json({ error: `Invalid ref name: ${refName}` });
      }

      const newHash = typeof update === 'string' ? update : update.new;
      const oldHash = typeof update === 'string' ? null : update.old;

      if (!vcsCore.objectExists(req.repoPath, newHash)) {
        return res.status(400).json({ error: `Object not found: ${newHash}` });
      }

      const currentHash = vcsCore.resolveRef(req.repoPath, refName);

      // Optimistic locking: if client sent old hash, verify it matches
      if (oldHash && oldHash !== '0'.repeat(64) && currentHash && currentHash !== oldHash) {
        // Remote has changed since client last fetched — need smart merge
        // Check if it's a fast-forward (new is descendant of current)
        if (vcsMerge.isAncestor(req.repoPath, currentHash, newHash)) {
          // Fast-forward: client's commit includes server's — just update
          vcsCore.updateRef(req.repoPath, refName, newHash);
          updatedRefs[refName] = newHash;
        } else {
          // Diverged: attempt auto-merge
          const username = req.vcsUser?.username || 'VPSHub';
          const branchName = refName.replace('refs/heads/', '');
          const mergeResult = vcsMerge.mergeCommits(req.repoPath, {
            ours: currentHash,
            theirs: newHash,
            authorName: username,
            authorEmail: `${username}@vpshub`,
            message: `Auto-merge: integrate push into ${branchName}`,
          });

          // Force-push philosophy: ALWAYS accept the push
          // mergeResult now always has a commitHash (even with conflicts)
          vcsCore.updateRef(req.repoPath, refName, mergeResult.commitHash);
          updatedRefs[refName] = mergeResult.commitHash;
          autoMerged = true;

          if (!mergeResult.success && mergeResult.conflicts) {
            // Conflicts exist but push is accepted with conflict markers in the code
            // Trigger background AI auto-resolve
            const conflictPaths = mergeResult.conflicts.map(c => c.path);
            console.log(`[VPC VCS] Push accepted with ${conflictPaths.length} conflict(s). Triggering AI auto-resolve...`);

            // Fire-and-forget: resolve conflicts in background
            const autoResolve = require('../services/autoResolveService');
            autoResolve.resolveInBackground(pool, {
              repoId: req.repoInfo.id,
              repoPath: req.repoPath,
              owner: req.repoInfo.owner_username,
              slug: req.repoInfo.slug,
              branchName,
              refName,
              mergeCommitHash: mergeResult.commitHash,
              conflicts: mergeResult.conflicts,
              username,
              authorId: req.vcsUser?.userId || req.repoInfo.owner_id,
            }).catch(err => console.error('[VPC VCS] Background auto-resolve error:', err.message));

            // Track conflict info for response (but push still succeeds)
            if (!autoMergeNotifications) autoMergeNotifications = [];
            autoMergeNotifications.push({
              type: 'conflicts_auto_resolving',
              message: `${conflictPaths.length} file(s) had conflicts with other changes. AI is resolving them automatically.`,
              files: conflictPaths,
            });
          }
        }
      } else {
        // No conflict scenario: direct update (fast-forward or first push)
        vcsCore.updateRef(req.repoPath, refName, newHash);
        updatedRefs[refName] = newHash;
      }
    }

    // Sync to DB (skip if tables don't exist yet)
    try { await vcsCore.syncRefsToDb(pool, req.repoInfo.id, req.repoPath); } catch { /* table may not exist */ }
    for (const [, hash] of Object.entries(updatedRefs)) {
      try { await vcsCore.syncCommitsToDb(pool, req.repoInfo.id, req.repoPath, hash); } catch { /* table may not exist */ }
    }

    // Update repo size and timestamp
    const { updateRepoSize } = require('../services/vpshubGitService');
    await updateRepoSize(pool, req.repoInfo.id, req.repoInfo.owner_username, req.repoInfo.slug);
    await pool.query('UPDATE vpshub_repositories SET updated_at = NOW() WHERE id = $1', [req.repoInfo.id]);

    // Auto-deploy hooks
    try {
      const deployService = require('../services/vpshubDeployService');
      await deployService.onPush(pool, req.repoInfo.owner_username, req.repoInfo.slug);
    } catch (err) {
      console.error('[VPC VCS] post-push deploy error:', err.message);
    }

    res.json({
      ok: true,
      updated_refs: updatedRefs,
      merged: autoMerged || undefined,
      message: autoMergeNotifications
        ? 'Your changes have been saved! AI is resolving some conflicts in the background.'
        : 'Your changes have been saved!',
      notifications: autoMergeNotifications || undefined,
    });

  } catch (err) {
    console.error('[VPC VCS] push error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pull (send objects to client) ───────────────────────────

router.post('/:owner/:repo/pull', resolveRepo, authenticateVcs, (req, res) => {
  try {
    const { wants = [], haves = [] } = req.body;
    const haveSet = new Set(haves);

    // Resolve wanted refs/hashes
    const wantHashes = [];
    for (const want of wants) {
      const hash = vcsCore.resolveRef(req.repoPath, want);
      if (hash) wantHashes.push(hash);
    }

    // Collect objects to send
    const objectsToSend = new Set();
    for (const wantHash of wantHashes) {
      const reachable = vcsCore.collectReachableObjects(req.repoPath, wantHash, haveSet);
      for (const hash of reachable) {
        if (!haveSet.has(hash)) {
          objectsToSend.add(hash);
        }
      }
    }

    // Get current ref values
    const refs = {};
    for (const want of wants) {
      const hash = vcsCore.resolveRef(req.repoPath, want);
      if (hash) refs[want] = hash;
    }

    // Send as JSON with base64-encoded compressed objects
    const objects = [];
    for (const hash of objectsToSend) {
      try {
        const rawCompressed = vcsCore.readObjectRaw(req.repoPath, hash);
        const obj = vcsCore.readObject(req.repoPath, hash);
        objects.push({
          hash,
          type: obj.type,
          data: rawCompressed.toString('base64'),
          compressed: true,
        });
      } catch { /* skip missing */ }
    }

    res.json({
      refs,
      objectCount: objects.length,
      objects,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pack Parsing ────────────────────────────────────────────

/**
 * Parse VPCPACK binary format:
 * VPCPACK\0<4-byte count>
 * Per object: <1-byte type><64-byte hex hash><4-byte size><compressed data>
 * Footer: JSON ref updates
 */
function parsePack(buffer) {
  const MAGIC = Buffer.from('VPCPACK\0');
  const objects = [];

  if (!buffer.slice(0, 8).equals(MAGIC)) {
    throw new Error('Invalid pack format');
  }

  const objectCount = buffer.readUInt32BE(8);
  let offset = 12;

  const typeMap = { 1: 'blob', 2: 'tree', 3: 'commit' };

  for (let i = 0; i < objectCount; i++) {
    const typeByte = buffer[offset];
    offset += 1;

    const hashHex = buffer.slice(offset, offset + 64).toString('ascii');
    offset += 64;

    const compressedSize = buffer.readUInt32BE(offset);
    offset += 4;

    const compressedData = buffer.slice(offset, offset + compressedSize);
    offset += compressedSize;

    objects.push({
      hash: hashHex,
      type: typeMap[typeByte] || 'unknown',
      data: compressedData.toString('base64'),
      compressed: true,
    });
  }

  // Remaining bytes are JSON ref updates
  let refs = {};
  if (offset < buffer.length) {
    try {
      refs = JSON.parse(buffer.slice(offset).toString('utf8'));
    } catch { /* no refs footer */ }
  }

  return { objects, refs };
}

/**
 * Build VPCPACK binary format
 */
function buildPack(objects, refs = {}) {
  const MAGIC = Buffer.from('VPCPACK\0');
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32BE(objects.length, 0);

  const typeMap = { blob: 1, tree: 2, commit: 3 };
  const parts = [MAGIC, countBuf];

  for (const obj of objects) {
    const typeBuf = Buffer.alloc(1);
    typeBuf[0] = typeMap[obj.type] || 0;

    const hashBuf = Buffer.from(obj.hash, 'ascii');
    const data = Buffer.from(obj.data, 'base64');

    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32BE(data.length, 0);

    parts.push(typeBuf, hashBuf, sizeBuf, data);
  }

  // Append refs as JSON footer
  parts.push(Buffer.from(JSON.stringify(refs)));

  return Buffer.concat(parts);
}

// ─── ZIP Download (HTTP Clone) ──────────────────────────────

const archiver = require('archiver');

router.get('/:owner/:repo/archive/:ref.zip', resolveRepo, authenticateVcs, (req, res) => {
  try {
    const ref = req.params.ref || 'main';
    const commitHash = vcsCore.resolveRef(req.repoPath, ref);
    if (!commitHash) return res.status(404).json({ error: 'Ref not found' });

    const commit = vcsCore.readCommit(req.repoPath, commitHash);
    const files = vcsCore.walkTree(req.repoPath, commit.tree);

    const repoName = `${req.repoInfo.slug}-${ref}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${repoName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const file of files) {
      try {
        const content = vcsCore.readBlob(req.repoPath, file.hash);
        archive.append(content, { name: `${repoName}/${file.path}` });
      } catch { /* skip unreadable */ }
    }

    archive.finalize();
  } catch (err) {
    console.error('[VPC VCS] archive error:', err.message);
    res.status(500).json({ error: 'Failed to create archive' });
  }
});

// Also support simple GET for download without auth (public repos)
router.get('/:owner/:repo/download', resolveRepo, async (req, res) => {
  try {
    if (req.repoInfo.visibility !== 'public') {
      // Check auth for private repos
      const pool = req.app.locals.pool;
      const authHeader = req.headers.authorization;
      const user = await authenticateGitRequest(pool, authHeader);
      if (!user) {
        res.setHeader('WWW-Authenticate', 'Basic realm="VPSHub"');
        return res.status(401).json({ error: 'Authentication required' });
      }
    }

    const ref = req.query.ref || 'main';
    const commitHash = vcsCore.resolveRef(req.repoPath, ref);
    if (!commitHash) return res.status(404).json({ error: 'Ref not found' });

    const commit = vcsCore.readCommit(req.repoPath, commitHash);
    const files = vcsCore.walkTree(req.repoPath, commit.tree);

    const repoName = `${req.repoInfo.slug}-${ref}`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${repoName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const file of files) {
      try {
        const content = vcsCore.readBlob(req.repoPath, file.hash);
        archive.append(content, { name: `${repoName}/${file.path}` });
      } catch { /* skip unreadable */ }
    }

    archive.finalize();

    // Track download for smart upload detection (fire-and-forget)
    if (req.vcsUser?.userId) {
      const { trackDownload } = require('../services/vpshubGitService');
      trackDownload(req.app.locals.pool, req.repoInfo.id, req.vcsUser.userId, ref, commitHash)
        .catch(() => {});
    }
  } catch (err) {
    console.error('[VPC VCS] download error:', err.message);
    res.status(500).json({ error: 'Failed to create archive' });
  }
});

// ─── Git-compatible discovery (partial) ─────────────────────
// Allows `git clone` to at least discover refs, even if full protocol isn't supported

router.get('/:owner/:repo/info/refs', resolveRepo, authenticateVcs, (req, res) => {
  try {
    const service = req.query.service;
    const refs = vcsCore.listRefs(req.repoPath, 'refs/');
    const head = vcsCore.readHead(req.repoPath);
    let headHash = head.symbolic ? vcsCore.resolveRef(req.repoPath, head.ref) : head.hash;

    if (service === 'git-upload-pack' || service === 'git-receive-pack') {
      // Git Smart HTTP discovery - return pkt-line format
      res.setHeader('Content-Type', `application/x-${service}-advertisement`);

      const lines = [];
      // Service announcement
      const svcLine = `# service=${service}\n`;
      lines.push(pktLine(svcLine));
      lines.push('0000'); // flush

      // HEAD
      if (headHash) {
        const defaultBranch = head.symbolic ? head.ref.replace('refs/heads/', '') : 'main';
        const capabilities = 'multi_ack_detailed side-band-64k thin-pack ofs-delta agent=vpshub/2.0';
        lines.push(pktLine(`${headHash} HEAD\0${capabilities}\n`));
      }

      // All refs
      for (const ref of refs) {
        lines.push(pktLine(`${ref.hash} ${ref.name}\n`));
      }
      lines.push('0000'); // flush

      res.end(lines.join(''));
    } else {
      // Dumb HTTP protocol - plain text
      res.setHeader('Content-Type', 'text/plain');
      let output = '';
      if (headHash) output += `${headHash}\tHEAD\n`;
      for (const ref of refs) {
        output += `${ref.hash}\t${ref.name}\n`;
      }
      res.end(output);
    }
  } catch (err) {
    console.error('[VPC VCS] info/refs error:', err.message);
    res.status(500).end('Internal Server Error');
  }
});

router.get('/:owner/:repo/HEAD', resolveRepo, (req, res) => {
  try {
    const head = vcsCore.readHead(req.repoPath);
    if (head.symbolic) {
      res.setHeader('Content-Type', 'text/plain');
      res.end(`ref: ${head.ref}\n`);
    } else {
      res.setHeader('Content-Type', 'text/plain');
      res.end(`${head.hash}\n`);
    }
  } catch (err) {
    res.status(500).end('Internal Server Error');
  }
});

function pktLine(data) {
  const len = data.length + 4;
  return len.toString(16).padStart(4, '0') + data;
}

module.exports = router;
module.exports.buildPack = buildPack;
module.exports.parsePack = parsePack;
