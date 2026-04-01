/**
 * VPC VCS Sync — Push/Pull over HTTP
 */

import * as fs from 'fs';
import * as path from 'path';
import { SyncApiClient } from '../api/client';
import * as objects from './objects';
import * as refs from './refs';
import * as index from './index';

export interface SyncResult {
  success: boolean;
  message: string;
  objectCount?: number;
  newHash?: string;
  merged?: boolean;
  prNumber?: number;
  conflicts?: string[];
}

export interface RemoteConfig {
  url: string;
  username: string;
  token: string;
}

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

// ─── Push ────────────────────────────────────────────────────

export async function push(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  const remote = getRemoteConfig(root);
  if (!remote) { return { success: false, message: 'No remote configured' }; }

  const branch = branchName || refs.getCurrentBranch(root) || 'main';
  const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
  if (!localHash) { return { success: false, message: `Branch '${branch}' has no commits` }; }

  // Get remote refs
  const remoteRefs = await client.vcsFetchRefs(remote.url, remote.username, remote.token);
  const remoteHash = remoteRefs.refs?.[`refs/heads/${branch}`] || '';

  if (remoteHash === localHash) {
    return { success: true, message: 'Already up to date', objectCount: 0 };
  }

  // Collect objects to send
  const remoteObjects = new Set<string>();
  const trackingHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);
  if (trackingHash) {
    try { objects.collectReachableObjects(root, trackingHash, new Set()).forEach(h => remoteObjects.add(h)); }
    catch { /* ignore */ }
  }

  const localObjects = objects.collectReachableObjects(root, localHash, new Set());
  const toSend: any[] = [];

  for (const hash of localObjects) {
    if (!remoteObjects.has(hash)) {
      try {
        const rawCompressed = objects.readObjectRaw(root, hash);
        const obj = objects.readObject(root, hash);
        toSend.push({ hash, type: obj.type, data: rawCompressed.toString('base64'), compressed: true });
      } catch { /* skip */ }
    }
  }

  // Push to server (send old hash for optimistic locking + smart merge)
  const result = await client.vcsPush(remote.url, remote.username, remote.token, toSend, {
    [`refs/heads/${branch}`]: { old: remoteHash, new: localHash },
  });

  // Handle auto-PR on conflict
  if (result.conflict && result.auto_pr) {
    return {
      success: false,
      message: `Merge conflicts. PR #${result.auto_pr.pr_number} created. Conflicts: ${result.auto_pr.conflicts.join(', ')}`,
      prNumber: result.auto_pr.pr_number,
      conflicts: result.auto_pr.conflicts,
    };
  }

  if (!result.ok && !result.merged) {
    return { success: false, message: result.error || 'Push failed' };
  }

  // Update remote tracking ref
  const finalHash = result.merged ? (result.updated_refs?.[`refs/heads/${branch}`] || localHash) : localHash;
  refs.updateRef(root, `refs/remotes/origin/${branch}`, finalHash);

  if (result.merged) {
    return { success: true, message: `Pushed with auto-merge (${finalHash.slice(0, 12)})`, objectCount: toSend.length, newHash: finalHash, merged: true };
  }

  return { success: true, message: `Pushed ${toSend.length} object(s)`, objectCount: toSend.length, newHash: localHash };
}

// ─── Pull ────────────────────────────────────────────────────

export async function pull(root: string, client: SyncApiClient, branchName?: string): Promise<SyncResult> {
  const remote = getRemoteConfig(root);
  if (!remote) { return { success: false, message: 'No remote configured' }; }

  const branch = branchName || refs.getCurrentBranch(root) || 'main';
  const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
  const haves = localHash ? [localHash] : [];

  // Pull objects from remote
  const result = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], haves);
  const remoteHash = result.refs?.[`refs/heads/${branch}`];

  if (!remoteHash) {
    return { success: false, message: `Branch '${branch}' not found on remote` };
  }

  if (remoteHash === localHash) {
    return { success: true, message: 'Already up to date', objectCount: 0 };
  }

  // Store received objects
  const vpc = objects.vpcDir(root);
  for (const obj of result.objects || []) {
    const objPath = path.join(vpc, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
    const dir = path.dirname(objPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    if (!fs.existsSync(objPath)) {
      fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
    }
  }

  // Update remote tracking ref
  refs.updateRef(root, `refs/remotes/origin/${branch}`, remoteHash);

  // Fast-forward local branch
  if (!localHash) {
    refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
  } else {
    // Check if fast-forward
    const isFF = isAncestor(root, localHash, remoteHash);
    if (isFF) {
      refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
    } else {
      return { success: true, message: `Fetched ${result.objects?.length || 0} object(s). Remote has diverged — manual merge needed.`, objectCount: result.objects?.length || 0 };
    }
  }

  // Update working tree
  try {
    const commit = objects.readCommit(root, remoteHash);
    const manifest = objects.walkTree(root, commit.tree);
    for (const file of manifest) {
      const absPath = path.resolve(root, file.path);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
    }
    index.buildIndexFromTree(root, commit.tree);
  } catch (err: any) {
    return { success: false, message: `Pull succeeded but checkout failed: ${err.message}` };
  }

  return {
    success: true,
    message: `Pulled ${result.objects?.length || 0} object(s). Now at ${remoteHash.slice(0, 12)}`,
    objectCount: result.objects?.length || 0,
    newHash: remoteHash,
  };
}

// ─── Clone ───────────────────────────────────────────────────

export async function cloneRepo(root: string, client: SyncApiClient, remoteUrl: string, username: string, token: string): Promise<SyncResult> {
  // Init .vpc structure
  objects.initRepo(root);
  setRemoteConfig(root, remoteUrl, username, token);

  // Fetch refs
  const remoteRefs = await client.vcsFetchRefs(remoteUrl, username, token);
  if (!remoteRefs.HEAD) {
    return { success: true, message: 'Cloned empty repository', objectCount: 0 };
  }

  // Pull all objects
  const allRefNames = Object.keys(remoteRefs.refs || {});
  const result = await client.vcsPull(remoteUrl, username, token, allRefNames, []);

  // Store objects
  const vpc = objects.vpcDir(root);
  for (const obj of result.objects || []) {
    const objPath = path.join(vpc, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
    const dir = path.dirname(objPath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    if (!fs.existsSync(objPath)) {
      fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
    }
  }

  // Set up refs
  for (const [refName, hash] of Object.entries(result.refs || {})) {
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

    // Checkout working tree
    const commit = objects.readCommit(root, defaultHash);
    const manifest = objects.walkTree(root, commit.tree);
    for (const file of manifest) {
      const absPath = path.resolve(root, file.path);
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
      fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
    }
    index.buildIndexFromTree(root, commit.tree);
  }

  return {
    success: true,
    message: `Cloned ${result.objects?.length || 0} objects (branch: ${defaultBranch})`,
    objectCount: result.objects?.length || 0,
    newHash: defaultHash || undefined,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

export function getSyncStatus(root: string): { ahead: number; behind: number; branch: string | null } {
  const branch = refs.getCurrentBranch(root);
  if (!branch) { return { ahead: 0, behind: 0, branch: null }; }

  const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
  const remoteHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);

  if (!localHash || !remoteHash) { return { ahead: 0, behind: 0, branch }; }
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
