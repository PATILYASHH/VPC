"use strict";
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
exports.HostingProvider = void 0;
const vscode = __importStar(require("vscode"));
class HostingProvider {
    constructor(client, onRefresh) {
        this.client = client;
        this.onRefresh = onRefresh;
    }
    refresh() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'refresh' });
            this.updateContent();
        }
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'deploy') {
                await this.deploy();
            }
            else if (msg.command === 'control') {
                await this.control(msg.action);
            }
            else if (msg.command === 'viewLogs') {
                await this.viewLogs();
            }
            else if (msg.command === 'refresh') {
                this.updateContent();
            }
        });
        this.updateContent();
    }
    async updateContent() {
        if (!this._view) {
            return;
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('vpshubUrl') || '';
        const token = config.get('vpshubToken') || '';
        const owner = config.get('vpshubOwner') || '';
        const repo = config.get('vpshubRepo') || '';
        if (!url || !token || !owner || !repo) {
            this._view.webview.html = this.getHtml(null, null);
            return;
        }
        try {
            const data = await this.client.vpshubGetHostingStatus(url, token, owner, repo);
            this._view.webview.html = this.getHtml(data.hosting, data.status);
        }
        catch {
            this._view.webview.html = this.getHtml(null, null);
        }
    }
    async deploy() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('vpshubUrl') || '';
        const token = config.get('vpshubToken') || '';
        const owner = config.get('vpshubOwner') || '';
        const repo = config.get('vpshubRepo') || '';
        try {
            const result = await this.client.vpshubDeployHosting(url, token, owner, repo);
            vscode.window.showInformationMessage(result.message || 'Deployed!');
            this.updateContent();
            this.onRefresh();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
        }
    }
    async control(action) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('vpshubUrl') || '';
        const token = config.get('vpshubToken') || '';
        const owner = config.get('vpshubOwner') || '';
        const repo = config.get('vpshubRepo') || '';
        try {
            const result = await this.client.vpshubHostingControl(url, token, owner, repo, action);
            vscode.window.showInformationMessage(result.message || `${action} done!`);
            this.updateContent();
            this.onRefresh();
        }
        catch (err) {
            vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
        }
    }
    async viewLogs() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('vpshubUrl') || '';
        const token = config.get('vpshubToken') || '';
        const owner = config.get('vpshubOwner') || '';
        const repo = config.get('vpshubRepo') || '';
        try {
            const data = await this.client.vpshubGetHostingLogs(url, token, owner, repo);
            const doc = await vscode.workspace.openTextDocument({ content: data.logs || 'No logs', language: 'log' });
            await vscode.window.showTextDocument(doc, { preview: true });
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed: ${err.message}`);
        }
    }
    getHtml(hosting, status) {
        if (!hosting) {
            return `<!DOCTYPE html><html><head><style>
        body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; font-size: 12px; }
        .empty { text-align: center; padding: 24px 0; opacity: 0.6; }
      </style></head><body>
        <div class="empty">
          <p>No hosting linked.</p>
          <p style="font-size:11px;">Link a hosting project in the VPSHub web UI Settings tab.</p>
        </div>
      </body></html>`;
        }
        const statusColor = status?.status === 'online' ? '#4ade80' :
            status?.status === 'stopped' ? '#a1a1aa' :
                status?.status === 'errored' ? '#ef4444' : '#fbbf24';
        const typeLabel = hosting.type === 'static' ? 'Static Site' : hosting.type === 'node' ? 'Node.js' : 'Fullstack';
        const isNodeApp = hosting.type !== 'static';
        return `<!DOCTYPE html><html><head><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; font-size: 12px; margin: 0; }
      .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
      .row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; }
      .name { font-weight: 600; font-size: 13px; }
      .meta { font-size: 11px; opacity: 0.6; }
      .status { font-weight: 600; text-transform: capitalize; }
      .stats { display: flex; gap: 12px; font-size: 11px; opacity: 0.7; margin-top: 4px; }
      .actions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
      button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-family: inherit; }
      button:hover { background: var(--vscode-button-hoverBackground); }
      button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      button.danger { background: #dc2626; color: white; }
    </style></head><body>
      <div class="card">
        <div class="row">
          <div class="dot" style="background:${statusColor}"></div>
          <span class="name">${hosting.name}</span>
        </div>
        <div class="row">
          <span class="meta">${typeLabel}</span>
          ${hosting.slug ? `<span class="meta">/${hosting.slug}</span>` : ''}
        </div>
        <div class="row">
          <span class="status" style="color:${statusColor}">${status?.status || 'unknown'}</span>
        </div>
        ${status?.uptime || status?.memory ? `<div class="stats">
          ${status?.uptime ? `<span>Uptime: ${status.uptime}</span>` : ''}
          ${status?.memory ? `<span>RAM: ${status.memory}</span>` : ''}
        </div>` : ''}
      </div>

      <div class="actions">
        <button onclick="send('deploy')">Deploy</button>
        ${isNodeApp ? `
          <button class="secondary" onclick="send('control','restart')">Restart</button>
          ${status?.status === 'online'
            ? `<button class="danger" onclick="send('control','stop')">Stop</button>`
            : `<button class="secondary" onclick="send('control','start')">Start</button>`}
        ` : ''}
        <button class="secondary" onclick="send('viewLogs')">Logs</button>
        <button class="secondary" onclick="send('refresh')">Refresh</button>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        function send(cmd, action) {
          vscode.postMessage({ command: cmd, action: action });
        }
      </script>
    </body></html>`;
    }
}
exports.HostingProvider = HostingProvider;
HostingProvider.viewType = 'vpcSync.hosting';
//# sourceMappingURL=hostingProvider.js.map