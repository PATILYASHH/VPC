"use strict";
/**
 * VPC Sync — Git-like SCM extension for VPC VCS
 *
 * Compact design: only native SCM panel + status bar.
 * No webviews. Fast activation. Like Git.
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const client_1 = require("./api/client");
const vpcScmProvider_1 = require("./scm/vpcScmProvider");
const panelProvider_1 = require("./views/panelProvider");
const objects = __importStar(require("./vcs/objects"));
const refs = __importStar(require("./vcs/refs"));
const index = __importStar(require("./vcs/index"));
const sync = __importStar(require("./vcs/sync"));
let scmProvider;
let client;
let panel;
let branchItem;
let syncItem;
let timer;
function activate(ctx) {
    client = new client_1.SyncApiClient();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // Status bar
    branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    branchItem.command = 'vpcSync.connect';
    ctx.subscriptions.push(branchItem);
    syncItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    ctx.subscriptions.push(syncItem);
    // Sidebar panel (single webview — connection form + push/pull)
    panel = new panelProvider_1.PanelProvider(client, ctx, () => initScm(ctx));
    ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('vpcSync.panel', panel));
    // ─── Commands ──────────────────────────────────────────
    ctx.subscriptions.push(vscode.commands.registerCommand('vpcSync.connect', () => {
        vscode.commands.executeCommand('vpcSync.panel.focus');
    }), 
    // Refresh
    vscode.commands.registerCommand('vpcSync.refresh', () => {
        scmProvider?.refresh();
        panel.refresh();
        updateStatusBar();
    }), 
    // Commit
    vscode.commands.registerCommand('vpcSync.commit', () => doCommit()), 
    // Push
    vscode.commands.registerCommand('vpcSync.push', () => doPush()), 
    // Pull
    vscode.commands.registerCommand('vpcSync.pull', () => doPull()), 
    // Stage file
    vscode.commands.registerCommand('vpcSync.stageFile', (res) => {
        if (!root || !res)
            return;
        index.stageFile(root, vscode.workspace.asRelativePath(res.resourceUri));
        scmProvider?.refresh();
    }), 
    // Unstage file
    vscode.commands.registerCommand('vpcSync.unstageFile', (res) => {
        if (!root || !res)
            return;
        const fp = vscode.workspace.asRelativePath(res.resourceUri);
        const head = refs.resolveRef(root, 'HEAD');
        if (head) {
            const manifest = objects.walkTree(root, objects.readCommit(root, head).tree);
            const entry = manifest.find(f => f.path === fp);
            if (entry) {
                const idx = index.readIndex(root);
                const i = idx.entries.findIndex(e => e.path === fp);
                if (i >= 0)
                    idx.entries[i].hash = entry.hash;
                else
                    idx.entries.push({ path: fp, hash: entry.hash, mode: entry.mode, size: 0, mtime: Date.now() });
                index.writeIndex(root, idx);
            }
            else {
                index.unstageFile(root, fp);
            }
        }
        scmProvider?.refresh();
    }), 
    // Stage all
    vscode.commands.registerCommand('vpcSync.stageAll', () => {
        if (!root)
            return;
        index.stageAllFiles(root);
        scmProvider?.refresh();
    }), 
    // Unstage all
    vscode.commands.registerCommand('vpcSync.unstageAll', () => {
        if (!root)
            return;
        const head = refs.resolveRef(root, 'HEAD');
        if (head)
            index.buildIndexFromTree(root, objects.readCommit(root, head).tree);
        scmProvider?.refresh();
    }), 
    // Open file
    vscode.commands.registerCommand('vpcSync.openFile', async (res) => {
        if (res)
            vscode.window.showTextDocument(await vscode.workspace.openTextDocument(res.resourceUri));
    }), 
    // Discard
    vscode.commands.registerCommand('vpcSync.discardFile', async (res) => {
        if (!root || !res)
            return;
        const fp = vscode.workspace.asRelativePath(res.resourceUri);
        const ok = await vscode.window.showWarningMessage(`Discard changes to ${fp}?`, { modal: true }, 'Discard');
        if (ok !== 'Discard')
            return;
        const idx = index.readIndex(root);
        const entry = idx.entries.find(e => e.path === fp);
        if (entry) {
            try {
                require('fs').writeFileSync(require('path').resolve(root, fp), objects.readBlob(root, entry.hash));
            }
            catch { }
        }
        scmProvider?.refresh();
    }));
    // ─── Init ──────────────────────────────────────────────
    if (root && objects.hasVpcRepo(root)) {
        initScm(ctx);
    }
    else {
        branchItem.text = '$(plug) VPC Sync';
        branchItem.tooltip = 'Connect to VPSHub';
        branchItem.show();
    }
    // Auto-refresh
    const interval = vscode.workspace.getConfiguration('vpcSync').get('autoRefreshInterval') || 0;
    if (interval > 0) {
        timer = setInterval(() => vscode.commands.executeCommand('vpcSync.refresh'), interval * 1000);
    }
    // File watcher — debounced
    if (root) {
        const w = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        const kick = () => scmProvider?.scheduleRefresh();
        w.onDidChange(kick);
        w.onDidCreate(kick);
        w.onDidDelete(kick);
        ctx.subscriptions.push(w);
    }
}
// ─── SCM Init ────────────────────────────────────────────
function initScm(ctx) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root)
        return;
    if (!scmProvider) {
        scmProvider = new vpcScmProvider_1.VpcScmProvider(root);
        ctx.subscriptions.push(scmProvider);
    }
    scmProvider.refresh();
    updateStatusBar();
}
// ─── Commit ──────────────────────────────────────────────
async function doCommit() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !scmProvider)
        return;
    let message = scmProvider.inputBox.value?.trim();
    if (!message) {
        message = await vscode.window.showInputBox({ prompt: 'Commit message' }) || '';
        if (!message.trim())
            return;
    }
    const idx = index.readIndex(root);
    const headHash = refs.resolveRef(root, 'HEAD');
    let hasChanges = false;
    if (headHash) {
        const headMap = new Map(objects.walkTree(root, objects.readCommit(root, headHash).tree).map(f => [f.path, f.hash]));
        const idxMap = new Map(idx.entries.map(e => [e.path, e.hash]));
        for (const [p, h] of idxMap) {
            if (headMap.get(p) !== h) {
                hasChanges = true;
                break;
            }
        }
        if (!hasChanges)
            for (const [p] of headMap) {
                if (!idxMap.has(p)) {
                    hasChanges = true;
                    break;
                }
            }
    }
    else {
        hasChanges = idx.entries.length > 0;
    }
    if (!hasChanges) {
        vscode.window.showInformationMessage('Nothing to commit.');
        return;
    }
    const treeHash = objects.buildTreeFromFiles(root, idx.entries);
    const username = vscode.workspace.getConfiguration('vpcSync').get('username') || 'user';
    const hash = objects.createCommit(root, {
        tree: treeHash,
        parents: headHash ? [headHash] : [],
        authorName: username,
        authorEmail: `${username}@vpc`,
        message,
    });
    const head = refs.readHead(root);
    if (head.symbolic && head.ref)
        refs.updateRef(root, head.ref, hash);
    else
        refs.writeHead(root, hash);
    scmProvider.inputBox.value = '';
    vscode.window.showInformationMessage(`${hash.slice(0, 8)}: ${message}`);
    scmProvider.refresh();
    updateStatusBar();
}
// ─── Push (creates PR) ──────────────────────────────────
async function doPush() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root)
        return;
    // Get PR title from user
    const title = await vscode.window.showInputBox({
        prompt: 'PR title (what does this change do?)',
        placeHolder: 'e.g. Fix login button styling',
    });
    if (!title)
        return; // user cancelled
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Creating PR...' }, async () => {
        try {
            const r = await sync.push(root, client, undefined, title);
            if (r.prNumber) {
                if (r.hasConflicts && r.conflictFiles && r.conflictFiles.length > 0) {
                    // Show conflict-aware notification with option to open PR for VPAI resolution
                    vscode.window.showWarningMessage(`PR #${r.prNumber} created with ${r.conflictFiles.length} conflict(s). Open in VPSHub to let VPAI resolve them.`, 'Open PR', 'Dismiss').then(action => {
                        if (action === 'Open PR') {
                            const config = vscode.workspace.getConfiguration('vpcSync');
                            const serverUrl = config.get('serverUrl') || '';
                            const repository = config.get('repository') || '';
                            if (serverUrl && repository) {
                                vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/#/vpshub/${repository}/pulls/${r.prNumber}`));
                            }
                        }
                    });
                }
                else {
                    vscode.window.showInformationMessage(r.message, 'View PR').then(action => {
                        if (action === 'View PR') {
                            const config = vscode.workspace.getConfiguration('vpcSync');
                            const serverUrl = config.get('serverUrl') || '';
                            const repository = config.get('repository') || '';
                            if (serverUrl && repository) {
                                vscode.env.openExternal(vscode.Uri.parse(`${serverUrl}/#/vpshub/${repository}/pulls/${r.prNumber}`));
                            }
                        }
                    });
                }
            }
            else {
                vscode.window.showInformationMessage(r.message);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Push: ${e.message}`);
        }
        scmProvider?.refresh();
        updateStatusBar();
    });
}
// ─── Pull ────────────────────────────────────────────────
async function doPull() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root)
        return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pulling...' }, async () => {
        try {
            const r = await sync.pull(root, client);
            vscode.window.showInformationMessage(r.message);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Pull: ${e.message}`);
        }
        scmProvider?.refresh();
        updateStatusBar();
    });
}
// ─── Status Bar ──────────────────────────────────────────
function updateStatusBar() {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !objects.hasVpcRepo(root)) {
        branchItem.text = '$(plug) VPC Sync';
        branchItem.show();
        syncItem.hide();
        return;
    }
    const branch = refs.getCurrentBranch(root);
    branchItem.text = `$(git-branch) ${branch || 'detached'}`;
    branchItem.tooltip = 'VPC Sync';
    branchItem.show();
    try {
        const s = sync.getSyncStatus(root);
        const parts = [];
        if (s.ahead > 0)
            parts.push(`${s.ahead}$(arrow-up)`);
        if (s.behind > 0)
            parts.push(`${s.behind}$(arrow-down)`);
        syncItem.text = parts.length > 0 ? parts.join(' ') : '$(check)';
        syncItem.tooltip = parts.length > 0 ? `${s.ahead} to push, ${s.behind} to pull` : 'Up to date';
        syncItem.command = s.behind > 0 ? 'vpcSync.pull' : 'vpcSync.push';
        syncItem.show();
    }
    catch {
        syncItem.hide();
    }
}
function deactivate() { if (timer)
    clearInterval(timer); }
//# sourceMappingURL=extension.js.map