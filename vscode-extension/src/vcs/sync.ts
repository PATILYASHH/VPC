/**
 * VPC VCS Sync — Push/Pull over HTTP
 * Now works like Git: direct push, merge on pull, branch management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';
import * as objects from './objects';
import * as refs from './refs';
import * as index from './index';
import * as merge from './merge';

export interface SyncResult {
  success: boolean;
  message: string;
  objectCount?: number;
  newHash?: string;
  merged?: boolean;
  prNumber?: number;
  conflicts?: string[];
  hasConflicts?: boolean;
  conflictFiles?: string[];
  notifications?: any[];
}

export interface RemoteConfig {
  url: string;
  username: string;
  token: string;
}

// ─── Lock file to prevent concurrent operations ─────────────

function acquireLock(root: string): boolean {
  const lockPath = path.join(objects.vpcDir(root), 'LOCK');
  try {
    if (fs.existsSync(lockPath)) {
      // Check if lock is stale (older than 5 minutes)
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
        fs.unlinkSync(lockPath);
      } else {
        return false;
      }
    }
    fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`);
    return true;
  } catch { return false; }
}

function releaseLock(root: string): void {
  try { fs.unlinkSync(path.join(objects.vpcDir(root), 'LOCK')); } catch { /* ignore */ }
}

// ─── Remote Config ──────────────────────────────────────────

function getRemoteConfig(root: string): RemoteConfig | null {
  const configPath = path.join(objects.vpcDir(root), 'config');
  if (!fs.existsSync(configPath)) { return null; }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const origin = config.remotes?.origin;
    if (!origin) { return null; }
    return { url: origin.url, username: origin.username || '', token: origin.token || '' };
  } catch { return null; }
}

export function setRemoteConfig(root: string, url: string, username: string, token: string): void {
  const configPath = path.join(objects.vpcDir(root), 'config');
  let config: any = { remotes: {} };
  if (fs.existsSync(configPath)) {
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* reset */ }
  }
  config.remotes = config.remotes || {};
  config.remotes.origin = { url, username, token };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ─── Push (direct push like git — force-push philosophy) ────

export async function push(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  if (!acquireLock(root)) {
    return { success: false, message: 'Another sync operation is in progress. Try again in a moment.' };
  }

  try {
    const remote = getRemoteConfig(root);
    if (!remote) { return { success: false, message: 'No remote configured. Connect to VPSHub first.' }; }

    const branch = branchName || refs.getCurrentBranch(root) || 'main';
    const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
    if (!localHash) { return { success: false, message: `Branch '${branch}' has no commits. Make a commit first.` }; }

    // Get remote refs
    let remoteRefs: any;
    try {
      remoteRefs = await client.vcsFetchRefs(remote.url, remote.username, remote.token);
    } catch (err: any) {
      return { success: false, message: `Cannot reach server: ${err.message}` };
    }

    const remoteHash = remoteRefs.refs?.[`refs/heads/${branch}`] || '';

    if (remoteHash === localHash) {
      return { success: true, message: 'Already up to date — nothing to push.', objectCount: 0 };
    }

    // Pre-push conflict detection: if remote exists and diverged, merge locally FIRST
    // so conflicts surface in the IDE before hitting protected/main branches.
    let effectiveLocalHash = localHash;
    if (remoteHash && remoteHash !== localHash) {
      // Ensure we have the remote commit objects locally so we can compute merge base
      if (!objects.objectExists(root, remoteHash)) {
        try {
          const pullRes = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], [localHash]);
          storeReceivedObjects(root, pullRes.objects || []);
        } catch (err: any) {
          return { success: false, message: `Cannot fetch remote for merge check: ${err.message}` };
        }
      }

      // Fast-forward from our side? (remote is ancestor of local)
      const remoteIsAncestor = merge.isAncestor(root, remoteHash, localHash);
      const localIsAncestor = merge.isAncestor(root, localHash, remoteHash);

      if (!remoteIsAncestor && !localIsAncestor) {
        // Diverged — run local 3-way merge
        const outcome = merge.mergeTrees(root, localHash, remoteHash);

        if (outcome.hasConflicts) {
          // Write merged files (with conflict markers) into working tree so the user can fix in VS Code
          for (const f of outcome.mergedFiles) {
            const absPath = path.resolve(root, f.path);
            if (!absPath.startsWith(root)) { continue; }
            const dir = path.dirname(absPath);
            if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
            try { fs.writeFileSync(absPath, objects.readBlob(root, f.hash)); } catch { /* skip */ }
          }
          // Refresh index to reflect the written working tree state
          index.buildIndexFromTree(root, outcome.mergedTreeHash);

          const conflictList = outcome.conflicts.map(c => `  • ${c.path}${c.type !== 'content' ? ` (${c.type})` : ''}`).join('\n');
          return {
            success: false,
            hasConflicts: true,
            conflictFiles: outcome.conflicts.map(c => c.path),
            message: `Push blocked — ${outcome.conflicts.length} merge conflict(s) with remote '${branch}':\n${conflictList}\n\nFix the <<<<<<< markers in the listed files, commit the resolution, then push again.`,
          };
        }

        // Clean merge — create a local merge commit and push that
        const username = vscode.workspace.getConfiguration('vpcSync').get<string>('username') || 'user';
        effectiveLocalHash = objects.createCommit(root, {
          tree: outcome.mergedTreeHash,
          parents: [localHash, remoteHash],
          authorName: username,
          authorEmail: `${username}@vpc`,
          message: `Merge remote '${branch}' into local`,
        });

        // Advance local branch & refresh working tree
        refs.updateRef(root, `refs/heads/${branch}`, effectiveLocalHash);
        checkoutTree(root, effectiveLocalHash);
      }
    }

    // Collect objects to send (only what remote doesn't have)
    const remoteObjects = new Set<string>();
    const trackingHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);
    if (trackingHash) {
      try { objects.collectReachableObjects(root, trackingHash, new Set()).forEach(h => remoteObjects.add(h)); }
      catch { /* ignore */ }
    }

    const localObjects = objects.collectReachableObjects(root, effectiveLocalHash, new Set());
    const toSend: any[] = [];

    for (const hash of localObjects) {
      if (!remoteObjects.has(hash)) {
        try {
          const rawCompressed = objects.readObjectRaw(root, hash);
          const obj = objects.readObject(root, hash);
          toSend.push({ hash, type: obj.type, data: rawCompressed.toString('base64'), compressed: true });
        } catch (err: any) {
          console.warn(`[VPC Sync] Skipping corrupt object ${hash}: ${err.message}`);
        }
      }
    }

    // Direct push to branch (local merge already resolved divergence if any)
    const refUpdate: Record<string, any> = {
      [`refs/heads/${branch}`]: { old: remoteHash || '0'.repeat(64), new: effectiveLocalHash },
    };

    let result: any;
    try {
      result = await client.vcsPush(remote.url, remote.username, remote.token, toSend, refUpdate);
    } catch (err: any) {
      return { success: false, message: `Push failed: ${err.message}` };
    }

    if (!result.ok) {
      return { success: false, message: result.error || result.message || 'Push failed on server.' };
    }

    // Update tracking ref
    const finalHash = result.updated_refs?.[`refs/heads/${branch}`] || effectiveLocalHash;
    refs.updateRef(root, `refs/remotes/origin/${branch}`, finalHash);

    // If server merged (our commit was integrated into a merge commit), update local
    if (result.merged && finalHash !== effectiveLocalHash) {
      // Pull the merge commit objects
      try {
        const pullResult = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], [effectiveLocalHash]);
        storeReceivedObjects(root, pullResult.objects || []);
        refs.updateRef(root, `refs/heads/${branch}`, finalHash);
        checkoutTree(root, finalHash);
      } catch { /* best effort sync-back */ }
    }

    // Build response message
    let message = effectiveLocalHash !== localHash
      ? `Merged remote changes locally, then pushed ${toSend.length} object(s) to ${branch}.`
      : `Pushed ${toSend.length} object(s) to ${branch}.`;
    if (result.merged) { message = `Pushed and auto-merged into ${branch}.`; }

    return {
      success: true,
      message,
      objectCount: toSend.length,
      newHash: finalHash,
      merged: result.merged,
      notifications: result.notifications,
    };
  } finally {
    releaseLock(root);
  }
}

// ─── Pull (with merge support) ──────────────────────────────

export async function pull(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  if (!acquireLock(root)) {
    return { success: false, message: 'Another sync operation is in progress.' };
  }

  try {
    const remote = getRemoteConfig(root);
    if (!remote) { return { success: false, message: 'No remote configured.' }; }

    const branch = branchName || refs.getCurrentBranch(root) || 'main';
    const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
    const haves = localHash ? [localHash] : [];

    // Pull objects from remote
    let result: any;
    try {
      result = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], haves);
    } catch (err: any) {
      return { success: false, message: `Pull failed: ${err.message}` };
    }

    const remoteHash = result.refs?.[`refs/heads/${branch}`];
    if (!remoteHash) {
      return { success: false, message: `Branch '${branch}' not found on remote.` };
    }

    if (remoteHash === localHash) {
      return { success: true, message: 'Already up to date.', objectCount: 0 };
    }

    // Store received objects
    storeReceivedObjects(root, result.objects || []);

    // Update remote tracking ref
    refs.updateRef(root, `refs/remotes/origin/${branch}`, remoteHash);

    // Determine merge strategy
    if (!localHash) {
      // First pull — just set branch
      refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
      checkoutTree(root, remoteHash);
      return {
        success: true,
        message: `Pulled ${result.objects?.length || 0} object(s). Branch set to ${remoteHash.slice(0, 12)}.`,
        objectCount: result.objects?.length || 0,
        newHash: remoteHash,
      };
    }

    // Check if fast-forward
    if (isAncestor(root, localHash, remoteHash)) {
      // Fast-forward
      refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
      checkoutTree(root, remoteHash);
      return {
        success: true,
        message: `Fast-forwarded to ${remoteHash.slice(0, 12)}. ${result.objects?.length || 0} new object(s).`,
        objectCount: result.objects?.length || 0,
        newHash: remoteHash,
      };
    }

    // Check if remote is behind (we're already ahead)
    if (isAncestor(root, remoteHash, localHash)) {
      return {
        success: true,
        message: 'Already up to date (you are ahead of remote).',
        objectCount: result.objects?.length || 0,
      };
    }

    // Diverged: create a local merge commit
    const username = vscode.workspace.getConfiguration('vpcSync').get<string>('username') || 'user';

    // Simple merge: take remote tree, create merge commit with two parents
    // This gives preference to remote changes (like git pull with default strategy)
    const mergeCommitHash = objects.createCommit(root, {
      tree: objects.readCommit(root, remoteHash).tree,
      parents: [localHash, remoteHash],
      authorName: username,
      authorEmail: `${username}@vpc`,
      message: `Merge remote '${branch}' into local`,
    });

    refs.updateRef(root, `refs/heads/${branch}`, mergeCommitHash);
    checkoutTree(root, mergeCommitHash);

    return {
      success: true,
      message: `Merged remote changes. Created merge commit ${mergeCommitHash.slice(0, 12)}.`,
      objectCount: result.objects?.length || 0,
      newHash: mergeCommitHash,
      merged: true,
    };
  } finally {
    releaseLock(root);
  }
}

// ─── Clone ──────────────────────────────────────────────────

export async function cloneRepo(root: string, client: SyncApiClient, remoteUrl: string, username: string, token: string): Promise<SyncResult> {
  // Init .vpc structure
  objects.initRepo(root);
  setRemoteConfig(root, remoteUrl, username, token);

  // Fetch refs
  let remoteRefs: any;
  try {
    remoteRefs = await client.vcsFetchRefs(remoteUrl, username, token);
  } catch (err: any) {
    return { success: false, message: `Cannot reach server: ${err.message}` };
  }

  if (!remoteRefs.HEAD) {
    return { success: true, message: 'Cloned empty repository.', objectCount: 0 };
  }

  // Pull all objects
  const allRefNames = Object.keys(remoteRefs.refs || {});
  let result: any;
  try {
    result = await client.vcsPull(remoteUrl, username, token, allRefNames, []);
  } catch (err: any) {
    return { success: false, message: `Clone failed: ${err.message}` };
  }

  // Store objects
  storeReceivedObjects(root, result.objects || []);

  // Set up remote tracking refs
  for (const [refName, hash] of Object.entries(result.refs || {}) as [string, string][]) {
    const shortName = refName.replace('refs/heads/', '').replace('refs/tags/', '');
    if (refName.startsWith('refs/heads/')) {
      refs.updateRef(root, `refs/remotes/origin/${shortName}`, hash);
    }
  }

  // Set default branch
  const defaultBranch = remoteRefs.defaultBranch || 'main';
  const defaultHash = remoteRefs.refs?.[`refs/heads/${defaultBranch}`] || remoteRefs.HEAD;

  if (defaultHash) {
    refs.updateRef(root, `refs/heads/${defaultBranch}`, defaultHash);
    refs.writeHead(root, `refs/heads/${defaultBranch}`);
    checkoutTree(root, defaultHash);
  }

  return {
    success: true,
    message: `Cloned ${result.objects?.length || 0} objects (branch: ${defaultBranch}).`,
    objectCount: result.objects?.length || 0,
    newHash: defaultHash || undefined,
  };
}

// ─── Branch Management ──────────────────────────────────────

export function createBranch(root: string, name: string, startPoint?: string): { success: boolean; message: string } {
  const hash = startPoint
    ? refs.resolveRef(root, startPoint)
    : refs.resolveRef(root, 'HEAD');

  if (!hash) {
    return { success: false, message: 'Cannot create branch: no commits yet.' };
  }

  const existing = refs.resolveRef(root, `refs/heads/${name}`);
  if (existing) {
    return { success: false, message: `Branch '${name}' already exists.` };
  }

  refs.updateRef(root, `refs/heads/${name}`, hash);
  return { success: true, message: `Created branch '${name}' at ${hash.slice(0, 12)}.` };
}

export function switchBranch(root: string, name: string): { success: boolean; message: string } {
  const hash = refs.resolveRef(root, `refs/heads/${name}`);
  if (!hash) {
    return { success: false, message: `Branch '${name}' does not exist.` };
  }

  // Check for uncommitted changes
  const idx = index.readIndex(root);
  const headHash = refs.resolveRef(root, 'HEAD');
  if (headHash) {
    const headMap = new Map(objects.walkTree(root, objects.readCommit(root, headHash).tree).map(f => [f.path, f.hash]));
    for (const fp of index.getAllWorkspaceFiles(root)) {
      try {
        const currentHash = objects.hashObject('blob', fs.readFileSync(path.resolve(root, fp)));
        const idxEntry = idx.entries.find(e => e.path === fp);
        if (idxEntry && idxEntry.hash !== currentHash) {
          return { success: false, message: 'You have uncommitted changes. Commit or discard them first.' };
        }
      } catch { /* skip */ }
    }
  }

  refs.writeHead(root, `refs/heads/${name}`);
  checkoutTree(root, hash);

  return { success: true, message: `Switched to branch '${name}'.` };
}

export function deleteBranch(root: string, name: string): { success: boolean; message: string } {
  const current = refs.getCurrentBranch(root);
  if (current === name) {
    return { success: false, message: `Cannot delete the current branch '${name}'.` };
  }

  const hash = refs.resolveRef(root, `refs/heads/${name}`);
  if (!hash) {
    return { success: false, message: `Branch '${name}' does not exist.` };
  }

  refs.deleteRef(root, `refs/heads/${name}`);
  return { success: true, message: `Deleted branch '${name}'.` };
}

export function listBranches(root: string): { name: string; hash: string; current: boolean }[] {
  const current = refs.getCurrentBranch(root);
  return refs.listBranches(root).map(b => ({
    ...b,
    current: b.name === current,
  }));
}

// ─── Entire Push (force replace remote) ────────────────────

export async function entirePush(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  if (!acquireLock(root)) {
    return { success: false, message: 'Another sync operation is in progress.' };
  }

  try {
    const remote = getRemoteConfig(root);
    if (!remote) { return { success: false, message: 'No remote configured.' }; }

    const branch = branchName || refs.getCurrentBranch(root) || 'main';
    const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
    if (!localHash) { return { success: false, message: `Branch '${branch}' has no commits.` }; }

    // Collect ALL local objects (no diff — send everything)
    const allObjects = objects.collectReachableObjects(root, localHash, new Set());
    const toSend: any[] = [];

    for (const hash of allObjects) {
      try {
        const rawCompressed = objects.readObjectRaw(root, hash);
        const obj = objects.readObject(root, hash);
        toSend.push({ hash, type: obj.type, data: rawCompressed.toString('base64'), compressed: true });
      } catch { /* skip */ }
    }

    const refUpdate: Record<string, any> = {
      [`refs/heads/${branch}`]: { old: '0'.repeat(64), new: localHash },
    };

    const result = await client.vcsEntirePush(remote.url, remote.username, remote.token, toSend, refUpdate);

    if (!result.ok) {
      return { success: false, message: result.error || 'Entire push failed.' };
    }

    // Update tracking ref
    refs.updateRef(root, `refs/remotes/origin/${branch}`, localHash);

    return {
      success: true,
      message: `Force pushed ${toSend.length} objects to ${branch}. Remote fully replaced.`,
      objectCount: toSend.length,
      newHash: localHash,
    };
  } finally {
    releaseLock(root);
  }
}

// ─── Entire Pull (force replace local) ─────────────────────

export async function entirePull(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  if (!acquireLock(root)) {
    return { success: false, message: 'Another sync operation is in progress.' };
  }

  try {
    const remote = getRemoteConfig(root);
    if (!remote) { return { success: false, message: 'No remote configured.' }; }

    const branch = branchName || refs.getCurrentBranch(root) || 'main';

    // Get ALL objects from remote (no haves — full download)
    const result = await client.vcsEntirePull(remote.url, remote.username, remote.token, branch);

    const remoteHash = result.refs?.[`refs/heads/${branch}`];
    if (!remoteHash) {
      return { success: false, message: `Branch '${branch}' not found on remote.` };
    }

    // Store all received objects
    storeReceivedObjects(root, result.objects || []);

    // Force update all refs
    refs.updateRef(root, `refs/remotes/origin/${branch}`, remoteHash);
    refs.updateRef(root, `refs/heads/${branch}`, remoteHash);

    // Force checkout — replaces all local files
    checkoutTree(root, remoteHash);

    return {
      success: true,
      message: `Force pulled ${result.objects?.length || 0} objects. Local fully replaced with remote.`,
      objectCount: result.objects?.length || 0,
      newHash: remoteHash,
    };
  } finally {
    releaseLock(root);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function storeReceivedObjects(root: string, objs: any[]): void {
  const vpc = objects.vpcDir(root);
  for (const obj of objs) {
    const objPath = path.join(vpc, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
    const dir = path.dirname(objPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    if (!fs.existsSync(objPath)) {
      fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
    }
  }
}

function checkoutTree(root: string, commitHash: string): void {
  const commit = objects.readCommit(root, commitHash);
  const manifest = objects.walkTree(root, commit.tree);
  for (const file of manifest) {
    const absPath = path.resolve(root, file.path);
    // Path traversal check
    if (!absPath.startsWith(root)) { continue; }
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
  }
  index.buildIndexFromTree(root, commit.tree);
}

export function getSyncStatus(root: string): { ahead: number; behind: number; branch: string | null } {
  const branch = refs.getCurrentBranch(root);
  if (!branch) { return { ahead: 0, behind: 0, branch: null }; }

  const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
  const remoteHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);

  if (!localHash) { return { ahead: 0, behind: 0, branch }; }
  if (!remoteHash) {
    // No remote tracking ref — count all local commits as ahead
    const ahead = countCommitsBetween(root, '', localHash);
    return { ahead: ahead || 1, behind: 0, branch };
  }
  if (localHash === remoteHash) { return { ahead: 0, behind: 0, branch }; }

  const ahead = countCommitsBetween(root, remoteHash, localHash);
  const behind = countCommitsBetween(root, localHash, remoteHash);

  return { ahead, behind, branch };
}

function countCommitsBetween(root: string, baseHash: string, tipHash: string): number {
  const baseAncestors = new Set<string>();
  const queue = [baseHash];
  while (queue.length > 0) {
    const h = queue.shift()!;
    if (baseAncestors.has(h)) { continue; }
    baseAncestors.add(h);
    try {
      const c = objects.readCommit(root, h);
      for (const p of c.parents) { queue.push(p); }
    } catch { break; }
  }

  let count = 0;
  const tipQueue = [tipHash];
  const visited = new Set<string>();
  while (tipQueue.length > 0) {
    const h = tipQueue.shift()!;
    if (visited.has(h) || baseAncestors.has(h)) { continue; }
    visited.add(h);
    count++;
    try {
      const c = objects.readCommit(root, h);
      for (const p of c.parents) { tipQueue.push(p); }
    } catch { break; }
  }
  return count;
}

function isAncestor(root: string, ancestorHash: string, descendantHash: string): boolean {
  const visited = new Set<string>();
  const queue = [descendantHash];
  while (queue.length > 0) {
    const h = queue.shift()!;
    if (h === ancestorHash) { return true; }
    if (visited.has(h)) { continue; }
    visited.add(h);
    try {
      const c = objects.readCommit(root, h);
      for (const p of c.parents) { if (!visited.has(p)) { queue.push(p); } }
    } catch { break; }
  }
  return false;
}
