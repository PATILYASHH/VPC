import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';

export class HostingProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vpcSync.hosting';
  private _view?: vscode.WebviewView;

  constructor(
    private client: SyncApiClient,
    private onRefresh: () => void,
  ) {}

  refresh(): void {
    if (this._view) {
      this._view.webview.postMessage({ type: 'refresh' });
      this.updateContent();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'deploy') { await this.deploy(); }
      else if (msg.command === 'control') { await this.control(msg.action); }
      else if (msg.command === 'viewLogs') { await this.viewLogs(); }
      else if (msg.command === 'refresh') { this.updateContent(); }
    });
    this.updateContent();
  }

  private async updateContent(): Promise<void> {
    if (!this._view) { return; }

    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl') || '';
    const token = config.get<string>('vpshubToken') || '';
    const owner = config.get<string>('vpshubOwner') || '';
    const repo = config.get<string>('vpshubRepo') || '';

    if (!url || !token || !owner || !repo) {
      this._view.webview.html = this.getHtml(null, null);
      return;
    }

    try {
      const data = await this.client.vpshubGetHostingStatus(url, token, owner, repo);
      this._view.webview.html = this.getHtml(data.hosting, data.status);
    } catch {
      this._view.webview.html = this.getHtml(null, null);
    }
  }

  private async deploy(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl') || '';
    const token = config.get<string>('vpshubToken') || '';
    const owner = config.get<string>('vpshubOwner') || '';
    const repo = config.get<string>('vpshubRepo') || '';

    try {
      const result = await this.client.vpshubDeployHosting(url, token, owner, repo);
      vscode.window.showInformationMessage(result.message || 'Deployed!');
      this.updateContent();
      this.onRefresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
    }
  }

  private async control(action: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl') || '';
    const token = config.get<string>('vpshubToken') || '';
    const owner = config.get<string>('vpshubOwner') || '';
    const repo = config.get<string>('vpshubRepo') || '';

    try {
      const result = await this.client.vpshubHostingControl(url, token, owner, repo, action);
      vscode.window.showInformationMessage(result.message || `${action} done!`);
      this.updateContent();
      this.onRefresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
    }
  }

  private async viewLogs(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl') || '';
    const token = config.get<string>('vpshubToken') || '';
    const owner = config.get<string>('vpshubOwner') || '';
    const repo = config.get<string>('vpshubRepo') || '';

    try {
      const data = await this.client.vpshubGetHostingLogs(url, token, owner, repo);
      const doc = await vscode.workspace.openTextDocument({ content: data.logs || 'No logs', language: 'log' });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed: ${err.message}`);
    }
  }

  private getHtml(hosting: any, status: any): string {
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
            : `<button class="secondary" onclick="send('control','start')">Start</button>`
          }
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
