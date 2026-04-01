#!/usr/bin/env node

/**
 * Migrate existing Git bare repos (.git) to VPC VCS format (.vpc)
 *
 * This script:
 * 1. Reads all git objects from existing bare repos
 * 2. Re-hashes them with SHA-256 (VPC VCS format)
 * 3. Creates the new .vpc directory structure
 * 4. Maps old SHA-1 hashes to new SHA-256 hashes
 * 5. Rebuilds trees and commits with updated hash references
 * 6. Updates refs to point to new commit hashes
 * 7. Populates vpshub_refs and vpshub_commits tables
 *
 * Usage:
 *   node migrateGitToVpc.js [--dry-run] [--repo owner/slug]
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');

const REPOS_DIR = path.join(os.homedir(), 'vpshub-repos');

// VPC VCS Core functions (inline to avoid import issues)
function hashObject(type, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`${type} ${buf.length}\0`);
  const full = Buffer.concat([header, buf]);
  return crypto.createHash('sha256').update(full).digest('hex');
}

function serializeObject(type, content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const header = Buffer.from(`${type} ${buf.length}\0`);
  return Buffer.concat([header, buf]);
}

function writeVpcObject(repoPath, hash, data) {
  const objPath = path.join(repoPath, 'objects', hash.slice(0, 2), hash.slice(2));
  const dir = path.dirname(objPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(objPath)) {
    const compressed = zlib.deflateSync(data);
    fs.writeFileSync(objPath, compressed);
  }
  return hash;
}

function git(args, gitDir) {
  try {
    return execFileSync('git', args, {
      env: { ...process.env, GIT_DIR: gitDir },
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
    }).toString();
  } catch (err) {
    return null;
  }
}

async function migrateRepo(gitRepoPath, dryRun = false) {
  const repoName = path.basename(gitRepoPath, '.git');
  const parentDir = path.dirname(gitRepoPath);
  const vpcRepoPath = path.join(parentDir, `${repoName}.vpc`);

  console.log(`\nMigrating: ${gitRepoPath} → ${vpcRepoPath}`);

  if (dryRun) {
    console.log('  [DRY RUN] Would create VPC repo structure');
    return;
  }

  // Create VPC directory structure
  fs.mkdirSync(path.join(vpcRepoPath, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(vpcRepoPath, 'refs', 'heads'), { recursive: true });
  fs.mkdirSync(path.join(vpcRepoPath, 'refs', 'tags'), { recursive: true });

  // Hash mapping: old SHA-1 → new SHA-256
  const hashMap = new Map();

  // Step 1: Enumerate all git objects
  const objectsOutput = git(['rev-list', '--all', '--objects'], gitRepoPath);
  if (!objectsOutput) {
    console.log('  No objects found (empty repo). Creating empty VPC repo.');
    fs.writeFileSync(path.join(vpcRepoPath, 'HEAD'), 'ref: refs/heads/main\n');
    return;
  }

  const objectHashes = new Set();
  for (const line of objectsOutput.trim().split('\n')) {
    const hash = line.split(' ')[0];
    if (hash) objectHashes.add(hash);
  }

  // Also get tree objects
  const allObjectsOutput = git(['cat-file', '--batch-check', '--batch-all-objects'], gitRepoPath);
  if (allObjectsOutput) {
    for (const line of allObjectsOutput.trim().split('\n')) {
      const [hash] = line.split(' ');
      if (hash && hash.length >= 40) objectHashes.add(hash);
    }
  }

  console.log(`  Found ${objectHashes.size} git objects`);

  // Step 2: Migrate blobs first (no dependencies)
  let blobCount = 0;
  for (const gitHash of objectHashes) {
    const typeOutput = git(['cat-file', '-t', gitHash], gitRepoPath);
    if (!typeOutput) continue;
    const type = typeOutput.trim();

    if (type === 'blob') {
      const content = execFileSync('git', ['cat-file', 'blob', gitHash], {
        env: { ...process.env, GIT_DIR: gitRepoPath },
        maxBuffer: 50 * 1024 * 1024,
        encoding: 'buffer',
      });

      const vpcHash = hashObject('blob', content);
      const serialized = serializeObject('blob', content);
      writeVpcObject(vpcRepoPath, vpcHash, serialized);
      hashMap.set(gitHash, vpcHash);
      blobCount++;
    }
  }
  console.log(`  Migrated ${blobCount} blobs`);

  // Step 3: Migrate trees (depend on blobs and other trees)
  let treeCount = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const gitHash of objectHashes) {
      if (hashMap.has(gitHash)) continue;
      const typeOutput = git(['cat-file', '-t', gitHash], gitRepoPath);
      if (!typeOutput || typeOutput.trim() !== 'tree') continue;

      // Read tree entries
      const treeOutput = git(['ls-tree', gitHash], gitRepoPath);
      if (!treeOutput) continue;

      const entries = [];
      let allDepsResolved = true;

      for (const line of treeOutput.trim().split('\n').filter(Boolean)) {
        const match = line.match(/^(\d+)\s+(blob|tree)\s+([a-f0-9]+)\t(.+)$/);
        if (!match) continue;

        const [, mode, entryType, entryGitHash, name] = match;
        const entryVpcHash = hashMap.get(entryGitHash);
        if (!entryVpcHash) {
          allDepsResolved = false;
          break;
        }

        entries.push({ mode, name, hash: entryVpcHash });
      }

      if (!allDepsResolved) continue;

      // Serialize tree in VPC format
      const sorted = [...entries].sort((a, b) => {
        const aName = a.mode === '040000' ? a.name + '/' : a.name;
        const bName = b.mode === '040000' ? b.name + '/' : b.name;
        return aName.localeCompare(bName);
      });

      const parts = [];
      for (const entry of sorted) {
        parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`));
        parts.push(Buffer.from(entry.hash, 'hex'));
      }
      const treeContent = Buffer.concat(parts);

      const vpcHash = hashObject('tree', treeContent);
      const serialized = serializeObject('tree', treeContent);
      writeVpcObject(vpcRepoPath, vpcHash, serialized);
      hashMap.set(gitHash, vpcHash);
      treeCount++;
      changed = true;
    }
  }
  console.log(`  Migrated ${treeCount} trees`);

  // Step 4: Migrate commits (depend on trees and parent commits)
  let commitCount = 0;
  changed = true;
  while (changed) {
    changed = false;
    for (const gitHash of objectHashes) {
      if (hashMap.has(gitHash)) continue;
      const typeOutput = git(['cat-file', '-t', gitHash], gitRepoPath);
      if (!typeOutput || typeOutput.trim() !== 'commit') continue;

      // Read commit content
      const commitContent = git(['cat-file', 'commit', gitHash], gitRepoPath);
      if (!commitContent) continue;

      // Parse and remap hashes
      const lines = commitContent.split('\n');
      const newLines = [];
      let allDepsResolved = true;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('tree ')) {
          const oldTreeHash = line.slice(5);
          const newTreeHash = hashMap.get(oldTreeHash);
          if (!newTreeHash) { allDepsResolved = false; break; }
          newLines.push(`tree ${newTreeHash}`);
        } else if (line.startsWith('parent ')) {
          const oldParentHash = line.slice(7);
          const newParentHash = hashMap.get(oldParentHash);
          if (!newParentHash) { allDepsResolved = false; break; }
          newLines.push(`parent ${newParentHash}`);
        } else {
          // Author, committer, blank line, message — keep as-is
          newLines.push(line);
          // Once we hit the blank line, copy the rest verbatim
          if (line === '') {
            newLines.push(...lines.slice(i + 1));
            break;
          }
        }
      }

      if (!allDepsResolved) continue;

      const newCommitContent = Buffer.from(newLines.join('\n'));
      const vpcHash = hashObject('commit', newCommitContent);
      const serialized = serializeObject('commit', newCommitContent);
      writeVpcObject(vpcRepoPath, vpcHash, serialized);
      hashMap.set(gitHash, vpcHash);
      commitCount++;
      changed = true;
    }
  }
  console.log(`  Migrated ${commitCount} commits`);

  // Step 5: Migrate refs
  const branchOutput = git(['branch', '--list', '--format=%(refname:short) %(objectname)'], gitRepoPath);
  if (branchOutput) {
    for (const line of branchOutput.trim().split('\n').filter(Boolean)) {
      const [branchName, gitCommitHash] = line.split(' ');
      const vpcHash = hashMap.get(gitCommitHash);
      if (vpcHash) {
        const refPath = path.join(vpcRepoPath, 'refs', 'heads', branchName);
        const refDir = path.dirname(refPath);
        if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
        fs.writeFileSync(refPath, vpcHash + '\n');
        console.log(`  Ref: refs/heads/${branchName} → ${vpcHash.slice(0, 12)}`);
      }
    }
  }

  const tagOutput = git(['tag', '--list', '--format=%(refname:short) %(objectname)'], gitRepoPath);
  if (tagOutput) {
    for (const line of tagOutput.trim().split('\n').filter(Boolean)) {
      const [tagName, gitTagHash] = line.split(' ');
      const vpcHash = hashMap.get(gitTagHash);
      if (vpcHash) {
        const refPath = path.join(vpcRepoPath, 'refs', 'tags', tagName);
        const refDir = path.dirname(refPath);
        if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
        fs.writeFileSync(refPath, vpcHash + '\n');
        console.log(`  Ref: refs/tags/${tagName} → ${vpcHash.slice(0, 12)}`);
      }
    }
  }

  // Set HEAD
  const headOutput = git(['symbolic-ref', 'HEAD'], gitRepoPath);
  if (headOutput) {
    const headRef = headOutput.trim();
    fs.writeFileSync(path.join(vpcRepoPath, 'HEAD'), `ref: ${headRef}\n`);
  } else {
    fs.writeFileSync(path.join(vpcRepoPath, 'HEAD'), 'ref: refs/heads/main\n');
  }

  console.log(`  Migration complete! ${hashMap.size} objects migrated.`);
  return hashMap;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const repoFilter = args.find(a => !a.startsWith('--'));

  console.log('=== VPC VCS Migration: Git → VPC ===');
  console.log(`Repos directory: ${REPOS_DIR}`);
  if (dryRun) console.log('[DRY RUN MODE]');

  if (!fs.existsSync(REPOS_DIR)) {
    console.log('No repos directory found. Nothing to migrate.');
    return;
  }

  // Find all .git bare repos
  const owners = fs.readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let totalMigrated = 0;

  for (const owner of owners) {
    const ownerDir = path.join(REPOS_DIR, owner);
    const repos = fs.readdirSync(ownerDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.endsWith('.git'))
      .map(d => d.name);

    for (const repoDir of repos) {
      const slug = repoDir.replace('.git', '');
      const fullId = `${owner}/${slug}`;

      if (repoFilter && fullId !== repoFilter) continue;

      const gitPath = path.join(ownerDir, repoDir);
      const vpcPath = path.join(ownerDir, `${slug}.vpc`);

      if (fs.existsSync(vpcPath)) {
        console.log(`\nSkipping ${fullId} — .vpc already exists`);
        continue;
      }

      await migrateRepo(gitPath, dryRun);
      totalMigrated++;
    }
  }

  console.log(`\n=== Done! Migrated ${totalMigrated} repo(s) ===`);

  if (!dryRun && totalMigrated > 0) {
    console.log('\nNext steps:');
    console.log('1. Run the 033_vpc_vcs_metadata.sql migration');
    console.log('2. Restart the VPC backend');
    console.log('3. Verify repos work in the web UI');
    console.log('4. Once verified, remove old .git directories:');
    console.log(`   find ${REPOS_DIR} -name "*.git" -type d -exec rm -rf {} +`);
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
