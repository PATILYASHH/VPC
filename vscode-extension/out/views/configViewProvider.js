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
exports.ConfigViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class ConfigViewProvider {
    constructor(client, onConfigured) {
        this.client = client;
        this.onConfigured = onConfigured;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'save': {
                    const config = vscode.workspace.getConfiguration('vpcSync');
                    await config.update('serverUrl', message.serverUrl, vscode.ConfigurationTarget.Workspace);
                    await config.update('apiKey', message.apiKey, vscode.ConfigurationTarget.Workspace);
                    if (message.outputFolder) {
                        await config.update('outputFolder', message.outputFolder, vscode.ConfigurationTarget.Workspace);
                    }
                    vscode.window.showInformationMessage('VPC Sync configured successfully!');
                    this.onConfigured();
                    this.refresh();
                    break;
                }
                case 'test': {
                    try {
                        const status = await this.client.getStatus(message.serverUrl, message.apiKey);
                        webviewView.webview.postMessage({
                            command: 'testResult',
                            success: true,
                            project: status.project.name,
                            slug: status.project.slug,
                            tracking: status.tracking_enabled,
                            pending: status.pending_changes,
                        });
                    }
                    catch (err) {
                        webviewView.webview.postMessage({
                            command: 'testResult',
                            success: false,
                            error: err.message,
                        });
                    }
                    break;
                }
                case 'disconnect': {
                    const config = vscode.workspace.getConfiguration('vpcSync');
                    await config.update('serverUrl', '', vscode.ConfigurationTarget.Workspace);
                    await config.update('apiKey', '', vscode.ConfigurationTarget.Workspace);
                    vscode.window.showInformationMessage('VPC Sync disconnected.');
                    this.onConfigured();
                    this.refresh();
                    break;
                }
            }
        });
    }
    refresh() {
        if (this._view) {
            this._view.webview.html = this.getHtml();
        }
    }
    getHtml() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const serverUrl = config.get('serverUrl') || '';
        const apiKey = config.get('apiKey') || '';
        const outputFolder = config.get('outputFolder') || './migrations';
        const isConnected = !!(serverUrl && apiKey);
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 12px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .header svg { width: 20px; height: 20px; }
  .header h2 {
    font-size: 13px;
    font-weight: 600;
  }
  .status-badge {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: auto;
  }
  .status-connected {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }
  .status-disconnected {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .form-group { margin-bottom: 14px; }
  label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  input, select {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px;
    outline: none;
  }
  input:focus {
    border-color: var(--vscode-focusBorder);
  }
  input::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  .hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 3px;
    line-height: 1.4;
  }
  .btn-row {
    display: flex;
    gap: 6px;
    margin-top: 16px;
  }
  button {
    flex: 1;
    padding: 7px 12px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .btn-danger {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .btn-danger:hover {
    background: rgba(239, 68, 68, 0.25);
  }
  .test-result {
    margin-top: 12px;
    padding: 10px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    display: none;
  }
  .test-success {
    display: block;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    color: #22c55e;
  }
  .test-error {
    display: block;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #ef4444;
  }
  .test-loading {
    display: block;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.25);
    color: #3b82f6;
  }
  .connected-info {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 14px;
  }
  .connected-info .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    padding: 3px 0;
  }
  .connected-info .row .label { color: var(--vscode-descriptionForeground); }
  .connected-info .row .value { font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .separator {
    border-top: 1px solid var(--vscode-panel-border);
    margin: 14px 0;
  }
  .masked { letter-spacing: 2px; }
</style>
</head>
<body>

<div class="header">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>
    <path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/>
  </svg>
  <h2>VPC Sync</h2>
  <span class="status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}">
    ${isConnected ? 'Connected' : 'Not Connected'}
  </span>
</div>

${isConnected ? `
<div class="connected-info">
  <div class="row">
    <span class="label">Server</span>
    <span class="value">${this.escapeHtml(serverUrl.replace(/https?:\/\//, '').split('/api')[0])}</span>
  </div>
  <div class="row">
    <span class="label">Project</span>
    <span class="value">${this.escapeHtml(serverUrl.split('/').pop() || '')}</span>
  </div>
  <div class="row">
    <span class="label">API Key</span>
    <span class="value masked">${this.escapeHtml(apiKey.substring(0, 12))}...</span>
  </div>
  <div class="row">
    <span class="label">Output</span>
    <span class="value">${this.escapeHtml(outputFolder)}</span>
  </div>
</div>
` : ''}

<div class="form-group">
  <label>Server URL</label>
  <input type="text" id="serverUrl" value="${this.escapeHtml(serverUrl)}"
    placeholder="http://185.199.53.139:8001/api/bana/v1/my-project" />
  <div class="hint">Full API URL including project slug</div>
</div>

<div class="form-group">
  <label>Pull API Key</label>
  <input type="password" id="apiKey" value="${this.escapeHtml(apiKey)}"
    placeholder="bana_pull_xxxxxxxxxxxx" />
  <div class="hint">Found in BanaDB → Pull Keys tab</div>
</div>

<div class="form-group">
  <label>Output Folder</label>
  <input type="text" id="outputFolder" value="${this.escapeHtml(outputFolder)}"
    placeholder="./migrations" />
  <div class="hint">Where pulled migration files are saved</div>
</div>

<div class="btn-row">
  <button class="btn-secondary" onclick="testConnection()">Test</button>
  <button class="btn-primary" onclick="saveConfig()">
    ${isConnected ? 'Update' : 'Connect'}
  </button>
</div>

${isConnected ? `
<div style="margin-top: 8px;">
  <button class="btn-danger" style="width:100%;" onclick="disconnect()">Disconnect</button>
</div>
` : ''}

<div id="testResult" class="test-result"></div>

<script>
  const vscode = acquireVsCodeApi();

  function saveConfig() {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    const outputFolder = document.getElementById('outputFolder').value.trim();

    if (!serverUrl) {
      showResult('error', 'Server URL is required');
      return;
    }
    if (!serverUrl.includes('/api/bana/v1/')) {
      showResult('error', 'URL must include /api/bana/v1/<project-slug>');
      return;
    }
    if (!apiKey) {
      showResult('error', 'API Key is required');
      return;
    }

    vscode.postMessage({ command: 'save', serverUrl, apiKey, outputFolder });
  }

  function testConnection() {
    const serverUrl = document.getElementById('serverUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();

    if (!serverUrl || !apiKey) {
      showResult('error', 'Enter Server URL and API Key first');
      return;
    }

    showResult('loading', 'Testing connection...');
    vscode.postMessage({ command: 'test', serverUrl, apiKey });
  }

  function disconnect() {
    vscode.postMessage({ command: 'disconnect' });
  }

  function showResult(type, html) {
    const el = document.getElementById('testResult');
    el.className = 'test-result test-' + type;
    el.innerHTML = html;
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.command === 'testResult') {
      if (msg.success) {
        showResult('success',
          '<strong>✓ Connected!</strong><br/>' +
          'Project: ' + msg.project + '<br/>' +
          'Tracking: ' + (msg.tracking ? 'ON' : 'OFF') + '<br/>' +
          'Pending changes: ' + msg.pending
        );
      } else {
        showResult('error', '<strong>✗ Failed</strong><br/>' + msg.error);
      }
    }
  });
</script>

</body>
</html>`;
    }
    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}
exports.ConfigViewProvider = ConfigViewProvider;
ConfigViewProvider.viewType = 'vpcSync.config';
//# sourceMappingURL=configViewProvider.js.map