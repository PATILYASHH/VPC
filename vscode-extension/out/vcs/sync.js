"use strict";
/**
 * VPC VCS Sync — Push/Pull over HTTP
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
exports.getSyncStatus = getSyncStatus;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const objects = __importStar(require("./objects"));
const refs = __importStar(require("./refs"));
const index = __importStar(require("./index"));
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
// ─── Push ────────────────────────────────────────────────────
async function push(root, client, branchName) {
    const remote = getRemoteConfig(root);
    if (!remote) {
        return { success: false, message: 'No remote configured' };
    }
    const branch = branchName || refs.getCurrentBranch(root) || 'main';
    const localHash = refs.resolveRef(root, `refs/heads/${branch}`);
    if (!localHash) {
        return { success: false, message: `Branch '${branch}' has no commits` };
    }
    // Get remote refs
    const remoteRefs = await client.vcsFetchRefs(remote.url, remote.username, remote.token);
    const remoteHash = remoteRefs.refs?.[`refs/heads/${branch}`] || '';
    if (remoteHash === localHash) {
        return { success: true, message: 'Already up to date', objectCount: 0 };
    }
    // Collect objects to send
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
            catch { /* skip */ }
        }
    }
    // Push to server
    const result = await client.vcsPush(remote.url, remote.username, remote.token, toSend, {
        [`refs/heads/${branch}`]: localHash,
    });
    if (!result.ok) {
        return { success: false, message: 'Push failed' };
    }
    // Update remote tracking ref
    refs.updateRef(root, `refs/remotes/origin/${branch}`, localHash);
    return { success: true, message: `Pushed ${toSend.length} object(s)`, objectCount: toSend.length, newHash: localHash };
}
// ─── Pull ────────────────────────────────────────────────────
async function pull(root, client, branchName) {
    const remote = getRemoteConfig(root);
    if (!remote) {
        return { success: false, message: 'No remote configured' };
    }
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
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(objPath)) {
            fs.writeFileSync(objPath, Buffer.from(obj.data, 'base64'));
        }
    }
    // Update remote tracking ref
    refs.updateRef(root, `refs/remotes/origin/${branch}`, remoteHash);
    // Fast-forward local branch
    if (!localHash) {
        refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
    }
    else {
        // Check if fast-forward
        const isFF = isAncestor(root, localHash, remoteHash);
        if (isFF) {
            refs.updateRef(root, `refs/heads/${branch}`, remoteHash);
        }
        else {
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
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absPath, objects.readBlob(root, file.hash));
        }
        index.buildIndexFromTree(root, commit.tree);
    }
    catch (err) {
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
async function cloneRepo(root, client, remoteUrl, username, token) {
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
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
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
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
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