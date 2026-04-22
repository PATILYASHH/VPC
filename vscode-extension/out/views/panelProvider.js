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
const deviceFlow_1 = require("../auth/deviceFlow");
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
                case 'signIn': return this.signIn();
                case 'fetchRepos': return this.fetchReposForSession();
                case 'cloneRepo': return this.cloneRepo(msg);
                case 'disconnect': return this.disconnect();
                case 'signOut': return this.signOut();
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
        // Re-render when the VPC authentication session changes (sign-in / sign-out elsewhere)
        vscode.authentication.onDidChangeSessions(e => {
            if (e.provider.id === deviceFlow_1.VPC_AUTH_PROVIDER_ID) {
                this.render();
            }
        });
    }
    async signIn() {
        try {
            const session = await (0, deviceFlow_1.getVpcSession)(true);
            if (!session) {
                return;
            }
            this.render();
            // Auto-load repo list after sign-in
            this.fetchReposForSession();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Sign-in failed: ${err.message}`);
        }
    }
    async fetchReposForSession() {
        const session = await (0, deviceFlow_1.getVpcSession)(false);
        if (!session) {
            this._view?.webview.postMessage({ command: 'error', text: 'Not signed in.' });
            return;
        }
        try {
            const result = await this.client.vpshubGetRepos(session.serverUrl, session.accessToken);
            this._view?.webview.postMessage({ command: 'repos', repos: result.repos || [] });
        }
        catch (err) {
            this._view?.webview.postMessage({ command: 'error', text: err.message });
        }
    }
    async signOut() {
        const all = await this.client;
        void all;
        await (0, deviceFlow_1.signOut)(this.ctx);
        await vscode.authentication.getSession(deviceFlow_1.VPC_AUTH_PROVIDER_ID, ['repo', 'sync'], { clearSessionPreference: true, createIfNone: false });
        vscode.window.showInformationMessage('Signed out of VPC.');
        this.render();
    }
    refresh() { this.render(); }
    async cloneRepo(msg) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const session = await (0, deviceFlow_1.getVpcSession)(false);
        if (!session) {
            vscode.window.showErrorMessage('Not signed in.');
            return;
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('serverUrl', session.serverUrl, vscode.ConfigurationTarget.Workspace);
        await config.update('username', session.username, vscode.ConfigurationTarget.Workspace);
        await config.update('repository', `${msg.owner}/${msg.repo}`, vscode.ConfigurationTarget.Workspace);
        const vcsUrl = `${session.serverUrl}/vcs/${msg.owner}/${msg.repo}`;
        if (objects.hasVpcRepo(root)) {
            sync.setRemoteConfig(root, vcsUrl, session.username, session.accessToken);
            vscode.window.showInformationMessage(`Connected to ${msg.owner}/${msg.repo}`);
            this.onConnected();
            this.render();
            return;
        }
        this._view?.webview.postMessage({ command: 'status', text: 'Cloning...' });
        try {
            const result = await sync.cloneRepo(root, this.client, vcsUrl, session.username, session.accessToken);
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
        await config.update('repository', undefined, vscode.ConfigurationTarget.Workspace);
        vscode.commands.executeCommand('setContext', 'vpc:connected', false);
        vscode.window.showInformationMessage('Disconnected from repository. Still signed in to VPC.');
        this.render();
    }
    render() {
        if (!this._view)
            return;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const connected = !!(root && objects.hasVpcRepo(root));
        // Load session asynchronously and re-render with it
        (0, deviceFlow_1.getVpcSession)(false).then(session => {
            if (!this._view)
                return;
            const config = vscode.workspace.getConfiguration('vpcSync');
            const repository = config.get('repository') || '';
            if (connected && session) {
                this._view.webview.html = this.connectedHtml(session.serverUrl, session.username, repository, root);
            }
            else if (session) {
                // Signed in but no repo connected — show repo picker
                this._view.webview.html = this.repoPickerHtml(session.serverUrl, session.username, session.account.label);
            }
            else {
                this._view.webview.html = this.signInHtml();
            }
        });
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
    // ─── Sign-in Screen (no PAT required) ──────────────────
    signInHtml() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:14px}
.hero{text-align:center;padding:20px 0 8px}
.logo{width:42px;height:42px;border-radius:10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;margin-bottom:12px}
h2{font-size:15px;font-weight:600;margin-bottom:6px}
.sub{font-size:11px;color:var(--vscode-descriptionForeground);line-height:1.5;margin-bottom:18px;max-width:220px;margin-left:auto;margin-right:auto}
.btn{width:100%;padding:10px;font-size:12px;font-weight:600;border:none;border-radius:6px;cursor:pointer}
.btn-primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.feat{margin-top:22px;padding:12px;border:1px solid var(--vscode-panel-border);border-radius:6px;font-size:11px;line-height:1.6;color:var(--vscode-descriptionForeground)}
.feat b{color:var(--vscode-foreground)}
.feat .dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--vscode-descriptionForeground);margin:0 6px 2px}
</style></head><body>

<div class="hero">
  <div class="logo">V</div>
  <h2>Sign in to VPC</h2>
  <div class="sub">Connects VPC and VPC Sync in one step — your browser approves, no tokens to paste.</div>
  <button class="btn btn-primary" onclick="post('signIn')">Sign in with Browser</button>
</div>

<div class="feat">
  <b>How it works</b><br>
  <span class="dot"></span>Click sign in<br>
  <span class="dot"></span>Approve in your browser<br>
  <span class="dot"></span>VS Code remembers you — securely
</div>

<script>
const vscode=acquireVsCodeApi();
function post(c){vscode.postMessage({command:c})}
</script>
</body></html>`;
    }
    // ─── Repo Picker (after sign-in, before clone) ─────────
    repoPickerHtml(serverUrl, username, displayName) {
        const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:10px}
.account{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--vscode-panel-border);border-radius:6px;margin-bottom:10px}
.account .who{display:flex;align-items:center;gap:8px}
.avatar{width:24px;height:24px;border-radius:50%;background:var(--vscode-button-background);color:var(--vscode-button-foreground);display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700}
.account .name{font-size:11px;font-weight:600}
.account .host{font-size:10px;color:var(--vscode-descriptionForeground)}
.signout{font-size:10px;color:var(--vscode-textLink-foreground);cursor:pointer;background:none;border:none}
.step{font-size:10px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 6px}
.repo-list{border:1px solid var(--vscode-panel-border);border-radius:6px;max-height:260px;overflow-y:auto}
.repo-item{padding:8px 10px;font-size:11px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);display:flex;justify-content:space-between;align-items:center}
.repo-item:last-child{border-bottom:none}
.repo-item:hover{background:var(--vscode-list-hoverBackground)}
.repo-name{font-weight:600;font-family:var(--vscode-editor-font-family)}
.repo-badge{font-size:9px;padding:1px 5px;border-radius:3px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.msg{font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;padding:14px}
.err{color:var(--vscode-errorForeground)}
</style></head><body>

<div class="account">
  <div class="who">
    <div class="avatar">${e((displayName || username || '?').charAt(0).toUpperCase())}</div>
    <div>
      <div class="name">${e(displayName || username)}</div>
      <div class="host">${e(serverUrl)}</div>
    </div>
  </div>
  <button class="signout" onclick="post('signOut')">Sign out</button>
</div>

<div class="step">Select repository</div>
<div id="repoList" class="repo-list"><div class="msg">Loading repositories...</div></div>

<script>
const vscode=acquireVsCodeApi();
function post(c){vscode.postMessage({command:c})}
function selectRepo(owner, slug){
  vscode.postMessage({ command: 'cloneRepo', owner, repo: slug });
}
window.addEventListener('message',(event)=>{
  const msg=event.data;
  const el=document.getElementById('repoList');
  if(msg.command==='repos'){
    if(!msg.repos||msg.repos.length===0){el.innerHTML='<div class="msg">No repositories found</div>';return;}
    el.innerHTML = msg.repos.map(function(r){
      const name = esc(r.owner_username) + '/' + esc(r.slug);
      return '<div class="repo-item" onclick="selectRepo(\\'' + esc(r.owner_username) + '\\',\\'' + esc(r.slug) + '\\')">' +
        '<span class="repo-name">' + name + '</span>' +
        '<span class="repo-badge">' + esc(r.visibility || 'private') + '</span></div>';
    }).join('');
  } else if(msg.command==='error'){
    el.innerHTML='<div class="msg err">'+esc(msg.text)+'</div>';
  } else if(msg.command==='status'){
    el.innerHTML='<div class="msg">'+esc(msg.text)+'</div>';
  }
});
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,"\\'").replace(/"/g,'&quot;');}
// Kick off repo load
post('fetchRepos');
</script>
</body></html>`;
    }
}
exports.PanelProvider = PanelProvider;
//# sourceMappingURL=panelProvider.js.map