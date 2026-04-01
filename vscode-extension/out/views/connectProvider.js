"use strict";
/**
 * Connect Provider — Token + Repository selection webview
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
exports.ConnectProvider = void 0;
const vscode = __importStar(require("vscode"));
const sync = __importStar(require("../vcs/sync"));
const objects = __importStar(require("../vcs/objects"));
class ConnectProvider {
    constructor(client, context, onConnected) {
        this.client = client;
        this.context = context;
        this.onConnected = onConnected;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.updateView();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'connect') {
                await this.handleConnect(msg.serverUrl, msg.token, msg.username);
            }
            else if (msg.command === 'selectRepo') {
                await this.handleSelectRepo(msg.serverUrl, msg.token, msg.username, msg.owner, msg.repo);
            }
            else if (msg.command === 'disconnect') {
                await this.handleDisconnect();
            }
            else if (msg.command === 'fetchRepos') {
                await this.fetchRepos(msg.serverUrl, msg.token);
            }
        });
    }
    async handleConnect(serverUrl, token, username) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Workspace);
        await config.update('token', token, vscode.ConfigurationTarget.Workspace);
        await config.update('username', username, vscode.ConfigurationTarget.Workspace);
        this.fetchRepos(serverUrl, token);
    }
    async fetchRepos(serverUrl, token) {
        try {
            const result = await this.client.vpshubGetRepos(serverUrl, token);
            const repos = result.repos || [];
            if (this._view) {
                this._view.webview.postMessage({ command: 'repoList', repos });
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to fetch repos: ${err.message}`);
            if (this._view) {
                this._view.webview.postMessage({ command: 'error', message: err.message });
            }
        }
    }
    async handleSelectRepo(serverUrl, token, username, owner, repo) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) {
            vscode.window.showErrorMessage('Open a folder first.');
            return;
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('repository', `${owner}/${repo}`, vscode.ConfigurationTarget.Workspace);
        const vcsUrl = `${serverUrl}/vcs/${owner}/${repo}`;
        if (objects.hasVpcRepo(root)) {
            // Already has .vpc — just update remote config
            sync.setRemoteConfig(root, vcsUrl, username, token);
            vscode.window.showInformationMessage(`Connected to ${owner}/${repo}`);
            this.onConnected();
            this.updateView();
            return;
        }
        // Clone the repo
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Cloning ${owner}/${repo}...` }, async () => {
            try {
                const result = await sync.cloneRepo(root, this.client, vcsUrl, username, token);
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
        });
        this.updateView();
    }
    async handleDisconnect() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        await config.update('serverUrl', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('token', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('repository', undefined, vscode.ConfigurationTarget.Workspace);
        await config.update('username', undefined, vscode.ConfigurationTarget.Workspace);
        vscode.commands.executeCommand('setContext', 'vpc:connected', false);
        this.updateView();
    }
    updateView() {
        if (!this._view) {
            return;
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const config = vscode.workspace.getConfiguration('vpcSync');
        const serverUrl = config.get('serverUrl') || '';
        const token = config.get('token') || '';
        const repository = config.get('repository') || '';
        const username = config.get('username') || '';
        const isConnected = !!(serverUrl && token && repository && root && objects.hasVpcRepo(root));
        this._view.webview.html = this.getHtml(serverUrl, token, username, repository, isConnected);
    }
    getHtml(serverUrl, token, username, repository, isConnected) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        if (isConnected) {
            return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; }
  .status { padding: 10px; border-radius: 6px; background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); margin-bottom: 12px; }
  .status h3 { font-size: 12px; color: #22c55e; margin: 0 0 6px; }
  .row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }
  .row .label { color: var(--vscode-descriptionForeground); }
  .row .value { font-family: var(--vscode-editor-font-family); font-weight: 600; }
  button { width: 100%; padding: 7px; font-size: 11px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; margin-top: 8px; }
  .btn-disconnect { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head><body>
<div class="status">
  <h3>Connected</h3>
  <div class="row"><span class="label">Server</span><span class="value">${esc(serverUrl)}</span></div>
  <div class="row"><span class="label">Repository</span><span class="value">${esc(repository)}</span></div>
  <div class="row"><span class="label">User</span><span class="value">${esc(username)}</span></div>
</div>
<button class="btn-disconnect" onclick="vscode.postMessage({command:'disconnect'})">Disconnect</button>
<script>const vscode = acquireVsCodeApi();</script>
</body></html>`;
        }
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; }
  h3 { font-size: 13px; margin: 0 0 12px; }
  label { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; margin-top: 10px; }
  input { width: 100%; padding: 6px 8px; font-size: 12px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  button { width: 100%; padding: 8px; font-size: 12px; font-weight: 600; border: none; border-radius: 4px; cursor: pointer; margin-top: 12px; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .repo-list { margin-top: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; max-height: 200px; overflow-y: auto; }
  .repo-item { padding: 8px 10px; font-size: 11px; cursor: pointer; border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; }
  .repo-item:last-child { border-bottom: none; }
  .repo-item:hover { background: var(--vscode-list-hoverBackground); }
  .repo-name { font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .repo-vis { font-size: 10px; opacity: 0.5; }
  .hidden { display: none; }
  .msg { font-size: 11px; color: var(--vscode-descriptionForeground); text-align: center; padding: 16px 0; }
</style></head><body>
<h3>Connect to VPSHub</h3>

<label>Server URL</label>
<input type="text" id="serverUrl" placeholder="http://your-server:8001" value="${esc(serverUrl)}" />

<label>Username</label>
<input type="text" id="username" placeholder="admin" value="${esc(username)}" />

<label>Personal Access Token</label>
<input type="password" id="token" placeholder="vpshub_..." value="${esc(token)}" />

<button class="btn-primary" onclick="connect()">Connect & Load Repos</button>

<div id="repoSection" class="hidden">
  <label>Select Repository</label>
  <div id="repoList" class="repo-list">
    <div class="msg">Loading repositories...</div>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let currentRepos = [];

  function connect() {
    const serverUrl = document.getElementById('serverUrl').value.replace(/\\/+$/, '');
    const token = document.getElementById('token').value;
    const username = document.getElementById('username').value;
    if (!serverUrl || !token || !username) { return; }
    vscode.postMessage({ command: 'connect', serverUrl, token, username });
    vscode.postMessage({ command: 'fetchRepos', serverUrl, token });
    document.getElementById('repoSection').classList.remove('hidden');
  }

  function selectRepo(owner, slug) {
    const serverUrl = document.getElementById('serverUrl').value.replace(/\\/+$/, '');
    const token = document.getElementById('token').value;
    const username = document.getElementById('username').value;
    vscode.postMessage({ command: 'selectRepo', serverUrl, token, username, owner, repo: slug });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'repoList') {
      currentRepos = msg.repos;
      const el = document.getElementById('repoList');
      if (msg.repos.length === 0) {
        el.innerHTML = '<div class="msg">No repositories found</div>';
        return;
      }
      el.innerHTML = msg.repos.map(r =>
        '<div class="repo-item" onclick="selectRepo(\\'' + r.owner_username + '\\',\\'' + r.slug + '\\')">' +
        '<span class="repo-name">' + r.owner_username + '/' + r.slug + '</span>' +
        '<span class="repo-vis">' + (r.visibility || 'private') + '</span></div>'
      ).join('');
      document.getElementById('repoSection').classList.remove('hidden');
    } else if (msg.command === 'error') {
      document.getElementById('repoList').innerHTML = '<div class="msg" style="color:#f87171;">Error: ' + msg.message + '</div>';
    }
  });
</script>
</body></html>`;
    }
}
exports.ConnectProvider = ConnectProvider;
//# sourceMappingURL=connectProvider.js.map