"use strict";
/**
 * VPC VCS Sync — Push/Pull over HTTP
 * Now works like Git: direct push, merge on pull, branch management
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setRemoteConfig = setRemoteConfig;
exports.push = push;
exports.pull = pull;
exports.cloneRepo = cloneRepo;
exports.createBranch = createBranch;
exports.switchBranch = switchBranch;
exports.deleteBranch = deleteBranch;
exports.listBranches = listBranches;
exports.getSyncStatus = getSyncStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const objects = __importStar(require("./objects"));
const refs = __importStar(require("./refs"));
const index = __importStar(require("./index"));
// ─── Lock file to prevent concurrent operations ─────────────
function acquireLock(root) {
    const lockPath = path.join(objects.vpcDir(root), 'LOCK');
    try {
        if (fs.existsSync(lockPath)) {
            // Check if lock is stale (older than 5 minutes)
            const stat = fs.statSync(lockPath);
            if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
                fs.unlinkSync(lockPath);
            }
            else {
                return false;
            }
        }
        fs.writeFileSync(lockPath, `${process.pid}\n${Date.now()}\n`);
        return true;
    }
    catch {
        return false;
    }
}
function releaseLock(root) {
    try {
        fs.unlinkSync(path.join(objects.vpcDir(root), 'LOCK'));
    }
    catch { /* ignore */ }
}
// ─── Remote Config ──────────────────────────────────────────
function getRemoteConfig(root) {
    const configPath = path.join(objects.vpcDir(root), 'config');
    if (!fs.existsSync(configPath)) {
        return null;
    }
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const origin = config.remotes?.origin;
        if (!origin) {
            return null;
        }
        return { url: origin.url, username: origin.username || '', token: origin.token || '' };
    }
    catch {
        return null;
    }
}
function setRemoteConfig(root, url, username, token) {
    const configPath = path.join(objects.vpcDir(root), 'config');
    let config = { remotes: {} };
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
        catch { /* reset */ }
    }
    config.remotes = config.remotes || {};
    config.remotes.origin = { url, username, token };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
// ─── Push (direct push like git — force-push philosophy) ────
async function push(root, client, branchName) {
    if (!acquireLock(root)) {
        return { success: false, message: 'Another sync operation is in progress. Try again in a moment.' };
    }
    try {
        const remote = getRemoteConfig(root);
        if (!remote) {
            return { success: false, message: 'No remote configured. Connect to VPSHub first.' };
        }
        const branch = branchName || refs.getCurrentBranch(root) || 'main';
        const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
        if (!localHash) {
            return { success: false, message: `Branch '${branch}' has no commits. Make a commit first.` };
        }
        // Get remote refs
        let remoteRefs;
        try {
            remoteRefs = await client.vcsFetchRefs(remote.url, remote.username, remote.token);
        }
        catch (err) {
            return { success: false, message: `Cannot reach server: ${err.message}` };
        }
        const remoteHash = remoteRefs.refs?.[`refs/heads/${branch}`] || '';
        if (remoteHash === localHash) {
            return { success: true, message: 'Already up to date — nothing to push.', objectCount: 0 };
        }
        // Collect objects to send (only what remote doesn't have)
        const remoteObjects = new Set();
        const trackingHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);
        if (trackingHash) {
            try {
                objects.collectReachableObjects(root, trackingHash, new Set()).forEach(h => remoteObjects.add(h));
            }
            catch { /* ignore */ }
        }
        const localObjects = objects.collectReachableObjects(root, localHash, new Set());
        const toSend = [];
        for (const hash of localObjects) {
            if (!remoteObjects.has(hash)) {
                try {
                    const rawCompressed = objects.readObjectRaw(root, hash);
                    const obj = objects.readObject(root, hash);
                    toSend.push({ hash, type: obj.type, data: rawCompressed.toString('base64'), compressed: true });
                }
                catch (err) {
                    console.warn(`[VPC Sync] Skipping corrupt object ${hash}: ${err.message}`);
                }
            }
        }
        // Direct push to branch (server handles merging/conflicts with force-push philosophy)
        const refUpdate = {
            [`refs/heads/${branch}`]: { old: remoteHash || '0'.repeat(64), new: localHash },
        };
        let result;
        try {
            result = await client.vcsPush(remote.url, remote.username, remote.token, toSend, refUpdate);
        }
        catch (err) {
            return { success: false, message: `Push failed: ${err.message}` };
        }
        if (!result.ok) {
            return { success: false, message: result.error || result.message || 'Push failed on server.' };
        }
        // Update tracking ref
        const finalHash = result.updated_refs?.[`refs/heads/${branch}`] || localHash;
        refs.updateRef(root, `refs/remotes/origin/${branch}`, finalHash);
        // If server merged (our commit was integrated into a merge commit), update local
        if (result.merged && finalHash !== localHash) {
            // Pull the merge commit objects
            try {
                const pullResult = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], [localHash]);
                storeReceivedObjects(root, pullResult.objects || []);
                refs.updateRef(root, `refs/heads/${branch}`, finalHash);
                checkoutTree(root, finalHash);
            }
            catch { /* best effort sync-back */ }
        }
        // Build response message
        let message = `Pushed ${toSend.length} object(s) to ${branch}.`;
        if (result.merged) {
            message = `Pushed and auto-merged into ${branch}.`;
        }
        return {
            success: true,
            message,
            objectCount: toSend.length,
            newHash: finalHash,
            merged: result.merged,
            notifications: result.notifications,
        };
    }
    finally {
        releaseLock(root);
    }
}
// ─── Pull (with merge support) ──────────────────────────────
async function pull(root, client, branchName) {
    if (!acquireLock(root)) {
        return { success: false, message: 'Another sync operation is in progress.' };
    }
    try {
        const remote = getRemoteConfig(root);
        if (!remote) {
            return { success: false, message: 'No remote configured.' };
        }
        const branch = branchName || refs.getCurrentBranch(root) || 'main';
        const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
        const haves = localHash ? [localHash] : [];
        // Pull objects from remote
        let result;
        try {
            result = await client.vcsPull(remote.url, remote.username, remote.token, [`refs/heads/${branch}`], haves);
        }
        catch (err) {
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
        const username = vscode.workspace.getConfiguration('vpcSync').get('username') || 'user';
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
    }
    finally {
        releaseLock(root);
    }
}
// ─── Clone ──────────────────────────────────────────────────
async function cloneRepo(root, client, remoteUrl, username, token) {
    // Init .vpc structure
    objects.initRepo(root);
    setRemoteConfig(root, remoteUrl, username, token);
    // Fetch refs
    let remoteRefs;
    try {
        remoteRefs = await client.vcsFetchRefs(remoteUrl, username, token);
    }
    catch (err) {
        return { success: false, message: `Cannot reach server: ${err.message}` };
    }
    if (!remoteRefs.HEAD) {
        return { success: true, message: 'Cloned empty repository.', objectCount: 0 };
    }
    // Pull all objects
    const allRefNames = Object.keys(remoteRefs.refs || {});
    let result;
    try {
        result = await client.vcsPull(remoteUrl, username, token, allRefNames, []);
    }
    catch (err) {
        return { success: false, message: `Clone failed: ${err.message}` };
    }
    // Store objects
    storeReceivedObjects(root, result.objects || []);
    // Set up remote tracking refs
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
function createBranch(root, name, startPoint) {
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
function switchBranch(root, name) {
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
            }
            catch { /* skip */ }
        }
    }
    refs.writeHead(root, `refs/heads/${name}`);
    checkoutTree(root, hash);
    return { success: true, message: `Switched to branch '${name}'.` };
}
function deleteBranch(root, name) {
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
function listBranches(root) {
    const current = refs.getCurrentBranch(root);
    return refs.listBranches(root).map(b => ({
        ...b,
        current: b.name === current,
    }));
}
// ─── Helpers ────────────────────────────────────────────────
function storeReceivedObjects(root, objs) {
    const vpc = objects.vpcDir(root);
    for (const obj of objs) {
        const objPath = path.join(vpc, 'objects', obj.hash.slice(0, 2), obj.hash.slice(2));
        const dir = path.dirname(objPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(objPath)) {
            fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
        }
    }
}
function checkoutTree(root, commitHash) {
    const commit = objects.readCommit(root, commitHash);
    const manifest = objects.walkTree(root, commit.tree);
    for (const file of manifest) {
        const absPath = path.resolve(root, file.path);
        // Path traversal check
        if (!absPath.startsWith(root)) {
            continue;
        }
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
    }
    index.buildIndexFromTree(root, commit.tree);
}
function getSyncStatus(root) {
    const branch = refs.getCurrentBranch(root);
    if (!branch) {
        return { ahead: 0, behind: 0, branch: null };
    }
    const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
    const remoteHash = refs.resolveRef(root, `refs/remotes/origin/${branch}`);
    if (!localHash || !remoteHash) {
        return { ahead: 0, behind: 0, branch };
    }
    if (localHash === remoteHash) {
        return { ahead: 0, behind: 0, branch };
    }
    const ahead = countCommitsBetween(root, remoteHash, localHash);
    const behind = countCommitsBetween(root, localHash, remoteHash);
    return { ahead, behind, branch };
}
function countCommitsBetween(root, baseHash, tipHash) {
    const baseAncestors = new Set();
    const queue = [baseHash];
    while (queue.length > 0) {
        const h = queue.shift();
        if (baseAncestors.has(h)) {
            continue;
        }
        baseAncestors.add(h);
        try {
            const c = objects.readCommit(root, h);
            for (const p of c.parents) {
                queue.push(p);
            }
        }
        catch {
            break;
        }
    }
    let count = 0;
    const tipQueue = [tipHash];
    const visited = new Set();
    while (tipQueue.length > 0) {
        const h = tipQueue.shift();
        if (visited.has(h) || baseAncestors.has(h)) {
            continue;
        }
        visited.add(h);
        count++;
        try {
            const c = objects.readCommit(root, h);
            for (const p of c.parents) {
                tipQueue.push(p);
            }
        }
        catch {
            break;
        }
    }
    return count;
}
function isAncestor(root, ancestorHash, descendantHash) {
    const visited = new Set();
    const queue = [descendantHash];
    while (queue.length > 0) {
        const h = queue.shift();
        if (h === ancestorHash) {
            return true;
        }
        if (visited.has(h)) {
            continue;
        }
        visited.add(h);
        try {
            const c = objects.readCommit(root, h);
            for (const p of c.parents) {
                if (!visited.has(p)) {
                    queue.push(p);
                }
            }
        }
        catch {
            break;
        }
    }
    return false;
}
//# sourceMappingURL=sync.js.map