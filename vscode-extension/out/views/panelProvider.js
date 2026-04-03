"use strict";
/**
 * VPC Sync Panel — Single webview in sidebar
 * Shows connection form when disconnected, repo info + push/pull when connected.
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
exports.PanelProvider = void 0;
const vscode = __importStar(require("vscode"));
const objects = __importStar(require("../vcs/objects"));
const refs = __importStar(require("../vcs/refs"));
const index = __importStar(require("../vcs/index"));
const sync = __importStar(require("../vcs/sync"));
class PanelProvider {
    constructor(client, ctx, onConnected) {
        this.client = client;
        this.ctx = ctx;
        this.onConnected = onConnected;
    }
    resolveWebviewView(view) {
        this._view = view;
        view.webview.options = { enableScripts: true };
        this.render();
        view.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.command) {
                case 'fetchRepos': return this.fetchRepos(msg);
                case 'cloneRepo': return this.cloneRepo(msg);
                case 'disconnect': return this.disconnect();
                case 'commit': return this.doCommit(msg.message);
                case 'stageAll': return vscode.commands.executeCommand('vpcSync.stageAll');
                case 'push': return vscode.commands.executeCommand('vpcSync.push');
                case 'pull': return vscode.commands.executeCommand('vpcSync.pull');
                case 'switchBranch': return vscode.commands.executeCommand('vpcSync.switchBranch');
                case 'createBranch': return vscode.commands.executeCommand('vpcSync.createBranch');
                case 'openScm': return vscode.commands.executeCommand('workbench.view.scm');
                case 'refresh':
                    this.render();
                    return;
            }
        });
    }
    refresh() { this.render(); }
    async fetchRepos(msg) {
        try {
            const result = await this.client.vpshubGetRepos(msg.serverUrl, msg.token);
            this._view?.webview.postMessage({ command: 'repos', repos: result.repos || [] });
        }
        catch (err) {
            this._view?.webview.postMessage({ command: 'error', text: err.message });
        }
    }
    async cloneRepo(msg) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('serverUrl', msg.serverUrl, vscode.ConfigurationTarget.Workspace);
        await config.update('token', msg.token, vscode.ConfigurationTarget.Workspace);
        await config.update('username', msg.username, vscode.ConfigurationTarget.Workspace);
        await config.update('repository', `${msg.owner}/${msg.repo}`, vscode.ConfigurationTarget.Workspace);
        const vcsUrl = `${msg.serverUrl}/vcs/${msg.owner}/${msg.repo}`;
        if (objects.hasVpcRepo(root)) {
            sync.setRemoteConfig(root, vcsUrl, msg.username, msg.token);
            vscode.window.showInformationMessage(`Connected to ${msg.owner}/${msg.repo}`);
            this.onConnected();
            this.render();
            return;
        }
        this._view?.webview.postMessage({ command: 'status', text: 'Cloning...' });
        try {
            const result = await sync.cloneRepo(root, this.client, vcsUrl, msg.username, msg.token);
            if (result.success) {
                vscode.window.showInformationMessage(result.message);
                this.onConnected();
            }
            else {
                vscode.window.showErrorMessage(result.message);
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Clone failed: ${err.message}`);
        }
        this.render();
    }
    async doCommit(message) {
        if (!message?.trim()) {
            vscode.window.showWarningMessage('Enter a commit message.');
            return;
        }
        // Stage all + commit via commands
        await vscode.commands.executeCommand('vpcSync.stageAll');
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root)
            return;
        const idx = index.readIndex(root);
        const headHash = refs.resolveRef(root, 'HEAD');
        let hasChanges = false;
        if (headHash) {
            const headMap = new Map(objects.walkTree(root, objects.readCommit(root, headHash).tree).map((f) => [f.path, f.hash]));
            const idxMap = new Map(idx.entries.map((e) => [e.path, e.hash]));
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
            this.render();
            return;
        }
        const treeHash = objects.buildTreeFromFiles(root, idx.entries);
        const config = vscode.workspace.getConfiguration('vpcSync');
        const username = config.get('username') || 'user';
        const hash = objects.createCommit(root, {
            tree: treeHash,
            parents: headHash ? [headHash] : [],
            authorName: username,
            authorEmail: `${username}@vpc`,
            message: message.trim(),
        });
        const head = refs.readHead(root);
        if (head.symbolic && head.ref)
            refs.updateRef(root, head.ref, hash);
        else
            refs.writeHead(root, hash);
        vscode.window.showInformationMessage(`Committed: ${hash.slice(0, 8)} — ${message.trim()}`);
        this.render();
    }
    async disconnect() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('serverUrl', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('token', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('repository', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('username', undefined, vscode.ConfigurationTarget.Workspace);
        vscode.commands.executeCommand('setContext', 'vpc:connected', false);
        vscode.window.showInformationMessage('Disconnected from VPSHub.');
        this.render();
    }
    render() {
        if (!this._view)
            return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const config = vscode.workspace.getConfiguration('vpcSync');
        const serverUrl = config.get('serverUrl') || '';
        const token = config.get('token') || '';
        const username = config.get('username') || '';
        const repository = config.get('repository') || '';
        const connected = !!(root && objects.hasVpcRepo(root));
        this._view.webview.html = connected
            ? this.connectedHtml(serverUrl, username, repository, root)
            : this.connectFormHtml(serverUrl, token, username);
    }
    // ─── Connected View ────────────────────────────────────
    connectedHtml(serverUrl, username, repository, root) {
        const branch = refs.getCurrentBranch(root) || 'main';
        let ahead = 0, behind = 0;
        try {
            const s = sync.getSyncStatus(root);
            ahead = s.ahead;
            behind = s.behind;
        }
        catch { }
        const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:10px}
.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:10px;margin-bottom:10px;background:var(--vscode-editor-background)}
.card h3{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px}
.row{display:flex;justify-content:space-between;font-size:11px;padding:2px 0}
.row .l{color:var(--vscode-descriptionForeground)}
.row .v{font-weight:600;font-family:var(--vscode-editor-font-family)}
.branch{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:4px 8px;border-radius:4px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);margin-bottom:10px}
.btns{display:flex;gap:6px;margin-bottom:6px}
.btn{flex:1;padding:7px;font-size:11px;font-weight:600;border:none;border-radius:5px;cursor:pointer;text-align:center}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-sm{padding:5px 10px;font-size:11px}
.sync{text-align:center;font-size:11px;padding:6px;border-radius:5px;margin-bottom:8px}
.sync-ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.15);color:#22c55e}
.sync-pending{background:rgba(234,179,8,.08);border:1px solid rgba(234,179,8,.15);color:#eab308}
.link{display:block;text-align:center;font-size:11px;color:var(--vscode-textLink-foreground);cursor:pointer;padding:4px;text-decoration:none}
.link:hover{text-decoration:underline}
.sep{border-top:1px solid var(--vscode-panel-border);margin:8px 0}
.commit-input{width:100%;padding:6px 8px;font-size:12px;font-family:var(--vscode-font-family);border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;outline:none;margin-bottom:6px;resize:none}
.commit-input:focus{border-color:var(--vscode-focusBorder)}
.step{font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;margin-top:2px}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:9px;font-weight:700;margin-right:4px}
</style></head><body>
<div class="branch">&#9741; ${e(branch)}</div>

${ahead === 0 && behind === 0
            ? '<div class="sync sync-ok">&#10003; Up to date</div>'
            : `<div class="sync sync-pending">${ahead > 0 ? '&#8593; ' + ahead + ' to push' : ''}${ahead > 0 && behind > 0 ? ' &middot; ' : ''}${behind > 0 ? '&#8595; ' + behind + ' to pull' : ''}</div>`}

<!-- Step 1: Commit -->
<div class="card">
  <div class="step"><span class="step-num">1</span> Commit Changes</div>
  <textarea class="commit-input" id="commitMsg" rows="2" placeholder="Commit message..."></textarea>
  <div class="btns">
    <button class="btn btn-primary" onclick="doCommit()">Stage All & Commit</button>
  </div>
</div>

<!-- Step 2: Push / Pull -->
<div class="card">
  <div class="step"><span class="step-num">2</span> Sync with Remote</div>
  <div class="btns">
    <button class="btn btn-primary" onclick="post('push')">Push${ahead > 0 ? ' (' + ahead + ')' : ''}</button>
    <button class="btn btn-secondary" onclick="post('pull')">Pull${behind > 0 ? ' (' + behind + ')' : ''}</button>
  </div>
</div>

<!-- Branch -->
<div class="card">
  <div class="step"><span class="step-num">3</span> Branch</div>
  <div class="btns">
    <button class="btn btn-secondary btn-sm" onclick="post('switchBranch')">Switch</button>
    <button class="btn btn-secondary btn-sm" onclick="post('createBranch')">New</button>
  </div>
</div>

<a class="link" onclick="post('openScm')">Open Source Control</a>

<div class="sep"></div>

<div class="card">
  <h3>Connection</h3>
  <div class="row"><span class="l">Server</span><span class="v">${e(serverUrl)}</span></div>
  <div class="row"><span class="l">Repo</span><span class="v">${e(repository)}</span></div>
  <div class="row"><span class="l">User</span><span class="v">${e(username)}</span></div>
</div>

<div style="display:flex;gap:6px;justify-content:center">
  <a class="link" onclick="post('refresh')">Refresh</a>
  <a class="link" onclick="post('disconnect')" style="color:var(--vscode-errorForeground)">Disconnect</a>
</div>

<script>
const vscode=acquireVsCodeApi();
function post(c){vscode.postMessage({command:c})}
function doCommit(){
  const msg=document.getElementById('commitMsg').value.trim();
  if(!msg){document.getElementById('commitMsg').focus();return;}
  vscode.postMessage({command:'commit',message:msg});
  document.getElementById('commitMsg').value='';
}
document.getElementById('commitMsg').addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doCommit();}
});
</script>
</body></html>`;
    }
    // ─── Connection Form ───────────────────────────────────
    connectFormHtml(serverUrl, token, username) {
        const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:10px}
h2{font-size:13px;font-weight:600;margin-bottom:4px}
.sub{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:14px}
label{display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin:10px 0 3px}
input{width:100%;padding:6px 8px;font-size:12px;font-family:var(--vscode-editor-font-family);border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:4px;outline:none}
input:focus{border-color:var(--vscode-focusBorder)}
.btn{width:100%;padding:8px;font-size:12px;font-weight:600;border:none;border-radius:5px;cursor:pointer;margin-top:12px}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-primary:disabled{opacity:.5;cursor:default}
.repo-list{margin-top:10px;border:1px solid var(--vscode-panel-border);border-radius:6px;max-height:220px;overflow-y:auto}
.repo-item{padding:8px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;align-items:center}
.repo-item:last-child{border-bottom:none}
.repo-item:hover{background:var(--vscode-list-hoverBackground)}
.repo-name{font-weight:600;font-family:var(--vscode-editor-font-family)}
.repo-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.hidden{display:none}
.msg{font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:14px}
.err{color:var(--vscode-errorForeground)}
.sep{border-top:1px solid var(--vscode-panel-border);margin:12px 0}
.step{font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.5px;margin-top:14px;margin-bottom:6px}
</style></head><body>

<h2>VPC Sync</h2>
<div class="sub">Connect to VPSHub to push, pull, and sync your code.</div>

<div class="step">1. Server Details</div>

<label>Server URL</label>
<input type="text" id="serverUrl" placeholder="http://your-server:8001" value="${e(serverUrl)}" />

<label>Username</label>
<input type="text" id="username" placeholder="admin" value="${e(username)}" />

<label>Personal Access Token</label>
<input type="password" id="token" placeholder="vpshub_..." value="${e(token)}" />

<button class="btn btn-primary" id="connectBtn" onclick="fetchRepos()">Connect</button>

<div id="repoSection" class="hidden">
  <div class="sep"></div>
  <div class="step">2. Select Repository</div>
  <div id="repoList" class="repo-list">
    <div class="msg">Loading repositories...</div>
  </div>
</div>

<div id="statusMsg" class="hidden msg"></div>

<script>
const vscode = acquireVsCodeApi();
let loadingRepos = false;

function val(id) { return document.getElementById(id).value.trim(); }

function fetchRepos() {
  const serverUrl = val('serverUrl').replace(/\\/+$/,'');
  const token = val('token');
  const username = val('username');
  if (!serverUrl || !token || !username) return;
  loadingRepos = true;
  document.getElementById('connectBtn').disabled = true;
  document.getElementById('connectBtn').textContent = 'Connecting...';
  document.getElementById('repoSection').classList.remove('hidden');
  document.getElementById('repoList').innerHTML = '<div class="msg">Loading repositories...</div>';
  vscode.postMessage({ command: 'fetchRepos', serverUrl, token, username });
}

function selectRepo(owner, slug) {
  const serverUrl = val('serverUrl').replace(/\\/+$/,'');
  const token = val('token');
  const username = val('username');
  document.getElementById('statusMsg').classList.remove('hidden');
  document.getElementById('statusMsg').textContent = 'Cloning ' + owner + '/' + slug + '...';
  document.getElementById('statusMsg').className = 'msg';
  vscode.postMessage({ command: 'cloneRepo', serverUrl, token, username, owner, repo: slug });
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'repos') {
    document.getElementById('connectBtn').disabled = false;
    document.getElementById('connectBtn').textContent = 'Connect';
    const el = document.getElementById('repoList');
    if (!msg.repos || msg.repos.length === 0) {
      el.innerHTML = '<div class="msg">No repositories found</div>';
      return;
    }
    el.innerHTML = msg.repos.map(r =>
      '<div class="repo-item" onclick="selectRepo(\\'' + esc(r.owner_username) + '\\',\\'' + esc(r.slug) + '\\')">' +
      '<span class="repo-name">' + esc(r.owner_username) + '/' + esc(r.slug) + '</span>' +
      '<span class="repo-badge">' + esc(r.visibility || 'private') + '</span></div>'
    ).join('');
  } else if (msg.command === 'error') {
    document.getElementById('connectBtn').disabled = false;
    document.getElementById('connectBtn').textContent = 'Connect';
    document.getElementById('repoList').innerHTML = '<div class="msg err">' + esc(msg.text) + '</div>';
  } else if (msg.command === 'status') {
    document.getElementById('statusMsg').classList.remove('hidden');
    document.getElementById('statusMsg').textContent = msg.text;
  }
});

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
</script>
</body></html>`;
    }
}
exports.PanelProvider = PanelProvider;
//# sourceMappingURL=panelProvider.js.map