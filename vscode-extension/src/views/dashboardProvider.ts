import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';

interface DashboardState {
  phase: 'connect' | 'selectRepo' | 'dashboard';
  vpshubUrl: string;
  vpshubToken: string;
  repos: any[];
  owner: string;
  repo: string;
  repoData: any | null;
  branch: string;
  branches: string[];
  // linked services
  dbProject: any | null;
  hosting: any | null;
  hostingStatus: any | null;
  // available for linking
  availableDbProjects: any[];
  availableHostingProjects: any[];
  // activity
  activity: any[];
  error: string;
  loading: boolean;
}

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vpcSync.dashboard';
  private _view?: vscode.WebviewView;
  private client: SyncApiClient;
  private onAction: () => void;
  private state: DashboardState;

  constructor(client: SyncApiClient, onAction: () => void) {
    this.client = client;
    this.onAction = onAction;
    this.state = this.getInitialState();
  }

  private getInitialState(): DashboardState {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const vpshubUrl = config.get<string>('vpshubUrl') || '';
    const vpshubToken = config.get<string>('vpshubToken') || '';
    const owner = config.get<string>('vpshubOwner') || '';
    const repo = config.get<string>('vpshubRepo') || '';
    const branch = config.get<string>('vpshubBranch') || 'main';

    let phase: DashboardState['phase'] = 'connect';
    if (vpshubUrl && vpshubToken && owner && repo) {
      phase = 'dashboard';
    } else if (vpshubUrl && vpshubToken) {
      phase = 'selectRepo';
    }

    return {
      phase, vpshubUrl, vpshubToken,
      repos: [], owner, repo, repoData: null,
      branch, branches: [],
      dbProject: null, hosting: null, hostingStatus: null,
      availableDbProjects: [], availableHostingProjects: [],
      activity: [], error: '', loading: false,
    };
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'connect':
          await this.handleConnect(msg.url, msg.token);
          break;
        case 'disconnect':
          await this.handleDisconnect();
          break;
        case 'selectRepo':
          await this.handleSelectRepo(msg.owner, msg.slug);
          break;
        case 'switchBranch':
          await this.handleSwitchBranch(msg.branch);
          break;
        case 'changeRepo':
          this.state.phase = 'selectRepo';
          await this.loadRepos();
          break;
        case 'refresh':
          await this.loadDashboard();
          break;
        case 'linkDb':
          await this.handleLinkDb(msg.projectId);
          break;
        case 'unlinkDb':
          await this.handleUnlinkDb();
          break;
        case 'linkHosting':
          await this.handleLinkHosting(msg.hostingId);
          break;
        case 'unlinkHosting':
          await this.handleUnlinkHosting();
          break;
        case 'deploy':
          await this.handleDeploy();
          break;
        case 'hostingControl':
          await this.handleHostingControl(msg.action);
          break;
        case 'viewLogs':
          await this.handleViewLogs();
          break;
        case 'openCommand':
          vscode.commands.executeCommand(msg.cmd);
          break;
      }
    });

    if (this.state.phase === 'selectRepo') {
      this.loadRepos();
    } else if (this.state.phase === 'dashboard') {
      this.loadDashboard();
    }
  }

  refresh(): void {
    if (this.state.phase === 'dashboard') {
      this.loadDashboard();
    }
  }

  // ─── Handlers ──────────────────────────────────────────────

  private async handleConnect(url: string, token: string): Promise<void> {
    this.state.loading = true;
    this.state.error = '';
    this.updateView();

    try {
      url = url.replace(/\/+$/, '').trim();
      token = token.replace(/[^\x20-\x7E]/g, '').trim();
      if (!url.startsWith('http')) { url = 'http://' + url; }
      if (!token) { throw new Error('Token is empty or invalid'); }

      const { repos } = await this.client.vpshubGetRepos(url, token);

      const config = vscode.workspace.getConfiguration('vpcSync');
      await config.update('vpshubUrl', url, vscode.ConfigurationTarget.Global);
      await config.update('vpshubToken', token, vscode.ConfigurationTarget.Global);

      this.state.vpshubUrl = url;
      this.state.vpshubToken = token;
      this.state.repos = repos;
      this.state.phase = 'selectRepo';
      this.state.loading = false;

      vscode.window.showInformationMessage(`Connected! Found ${repos.length} repo(s).`);
    } catch (err: any) {
      this.state.error = err.message || 'Connection failed';
      this.state.loading = false;
    }

    this.updateView();
  }

  private async handleDisconnect(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    await config.update('vpshubUrl', '', vscode.ConfigurationTarget.Global);
    await config.update('vpshubToken', '', vscode.ConfigurationTarget.Global);
    await config.update('vpshubOwner', '', vscode.ConfigurationTarget.Workspace);
    await config.update('vpshubRepo', '', vscode.ConfigurationTarget.Workspace);
    await config.update('vpshubBranch', 'main', vscode.ConfigurationTarget.Workspace);

    this.state = this.getInitialState();
    this.state.phase = 'connect';
    this.updateView();
    this.onAction();
    vscode.window.showInformationMessage('Disconnected from VPSHub.');
  }

  private async handleSelectRepo(owner: string, slug: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    await config.update('vpshubOwner', owner, vscode.ConfigurationTarget.Workspace);
    await config.update('vpshubRepo', slug, vscode.ConfigurationTarget.Workspace);
    await config.update('vpshubBranch', 'main', vscode.ConfigurationTarget.Workspace);

    this.state.owner = owner;
    this.state.repo = slug;
    this.state.branch = 'main';
    this.state.phase = 'dashboard';

    await this.loadDashboard();
    this.onAction();
  }

  private async handleSwitchBranch(branch: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    await config.update('vpshubBranch', branch, vscode.ConfigurationTarget.Workspace);
    this.state.branch = branch;
    this.updateView();
    this.onAction();
  }

  private async handleLinkDb(projectId: string): Promise<void> {
    if (!projectId) { return; }
    try {
      await this.client.vpshubLinkDb(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo, projectId
      );
      vscode.window.showInformationMessage('Database linked!');
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to link database: ${err.message}`);
    }
  }

  private async handleUnlinkDb(): Promise<void> {
    try {
      await this.client.vpshubUnlinkDb(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo
      );
      vscode.window.showInformationMessage('Database unlinked');
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to unlink: ${err.message}`);
    }
  }

  private async handleLinkHosting(hostingId: string): Promise<void> {
    if (!hostingId) { return; }
    try {
      await this.client.vpshubLinkHosting(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo, hostingId
      );
      vscode.window.showInformationMessage('Hosting linked!');
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to link hosting: ${err.message}`);
    }
  }

  private async handleUnlinkHosting(): Promise<void> {
    try {
      await this.client.vpshubUnlinkHosting(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo
      );
      vscode.window.showInformationMessage('Hosting unlinked');
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to unlink: ${err.message}`);
    }
  }

  private async handleDeploy(): Promise<void> {
    try {
      const result = await this.client.vpshubDeployHosting(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo
      );
      vscode.window.showInformationMessage(result.message || 'Deployed!');
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
    }
  }

  private async handleHostingControl(action: string): Promise<void> {
    try {
      const result = await this.client.vpshubHostingControl(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo, action
      );
      vscode.window.showInformationMessage(result.message || `${action} done!`);
      await this.loadDashboard();
      this.onAction();
    } catch (err: any) {
      vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
    }
  }

  private async handleViewLogs(): Promise<void> {
    try {
      const data = await this.client.vpshubGetHostingLogs(
        this.state.vpshubUrl, this.state.vpshubToken,
        this.state.owner, this.state.repo
      );
      const doc = await vscode.workspace.openTextDocument({ content: data.logs || 'No logs', language: 'log' });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed: ${err.message}`);
    }
  }

  // ─── Data loading ──────────────────────────────────────────

  private async loadRepos(): Promise<void> {
    this.state.loading = true;
    this.updateView();
    try {
      const { repos } = await this.client.vpshubGetRepos(this.state.vpshubUrl, this.state.vpshubToken);
      this.state.repos = repos;
      this.state.loading = false;
    } catch (err: any) {
      this.state.error = err.message;
      this.state.loading = false;
    }
    this.updateView();
  }

  private async loadDashboard(): Promise<void> {
    if (!this.state.vpshubUrl || !this.state.vpshubToken || !this.state.owner || !this.state.repo) {
      return;
    }

    this.state.loading = true;
    this.updateView();

    const url = this.state.vpshubUrl;
    const token = this.state.vpshubToken;
    const owner = this.state.owner;
    const repo = this.state.repo;

    try {
      const [repoResult, branchResult, dbResult, hostingResult, dbProjectsResult, hostingProjectsResult, activityResult] = await Promise.allSettled([
        this.client.vpshubGetRepo(url, token, owner, repo),
        this.client.vpshubGetBranches(url, token, owner, repo),
        this.client.vpshubGetLinkedDb(url, token, owner, repo),
        this.client.vpshubGetHostingStatus(url, token, owner, repo),
        this.client.vpshubGetProjects(url, token),
        this.client.vpshubGetHostingProjects(url, token),
        this.client.vpshubGetActivity(url, token, owner, repo, 5),
      ]);

      if (repoResult.status === 'fulfilled') {
        this.state.repoData = repoResult.value.repo;
      }
      if (branchResult.status === 'fulfilled') {
        this.state.branches = branchResult.value.branches || [];
      }
      if (dbResult.status === 'fulfilled') {
        this.state.dbProject = dbResult.value.project;
      }
      if (hostingResult.status === 'fulfilled') {
        this.state.hosting = hostingResult.value.hosting;
        this.state.hostingStatus = hostingResult.value.status;
      }
      if (dbProjectsResult.status === 'fulfilled') {
        this.state.availableDbProjects = dbProjectsResult.value.projects || [];
      }
      if (hostingProjectsResult.status === 'fulfilled') {
        this.state.availableHostingProjects = hostingProjectsResult.value.projects || [];
      }
      if (activityResult.status === 'fulfilled') {
        this.state.activity = activityResult.value.activity || [];
      }

      this.state.loading = false;
      this.state.error = '';
    } catch (err: any) {
      this.state.error = err.message;
      this.state.loading = false;
    }

    this.updateView();
  }

  // ─── View ──────────────────────────────────────────────────

  private updateView(): void {
    if (this._view) {
      this._view.webview.html = this.render();
    }
  }

  private render(): string {
    switch (this.state.phase) {
      case 'connect': return this.renderConnect();
      case 'selectRepo': return this.renderSelectRepo();
      case 'dashboard': return this.renderDashboard();
    }
  }

  // ─── Connect Screen ────────────────────────────────────────

  private renderConnect(): string {
    return this.wrap(`
      <div class="welcome">
        <div class="logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="12" fill="var(--accent)" opacity="0.15"/>
            <path d="M24 12L14 18v12l10 6 10-6V18L24 12z" stroke="var(--accent)" stroke-width="2" fill="none"/>
            <circle cx="24" cy="24" r="4" fill="var(--accent)"/>
            <line x1="24" y1="12" x2="24" y2="20" stroke="var(--accent)" stroke-width="1.5"/>
            <line x1="24" y1="28" x2="24" y2="36" stroke="var(--accent)" stroke-width="1.5"/>
            <line x1="14" y1="18" x2="20" y2="22" stroke="var(--accent)" stroke-width="1.5"/>
            <line x1="28" y1="26" x2="34" y2="30" stroke="var(--accent)" stroke-width="1.5"/>
          </svg>
        </div>
        <h1>VPC Sync</h1>
        <p class="subtitle">Connect to manage repos, databases, and hosting.</p>

        <div class="connect-form">
          <div class="field">
            <label>VPS Address</label>
            <input type="text" id="url" placeholder="http://your-vps-ip:8001" value="${this.esc(this.state.vpshubUrl)}" />
          </div>

          <div class="field">
            <label>Token</label>
            <input type="password" id="token" placeholder="Paste your VPSHub token" value="${this.esc(this.state.vpshubToken)}" />
          </div>

          ${this.state.error ? `<div class="error-msg">${this.esc(this.state.error)}</div>` : ''}

          <button class="btn-primary btn-full btn-lg" onclick="connect()" ${this.state.loading ? 'disabled' : ''}>
            ${this.state.loading ? '<span class="spinner"></span> Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    `);
  }

  // ─── Repo Selection Screen ─────────────────────────────────

  private renderSelectRepo(): string {
    const repos = this.state.repos;

    const repoCards = repos.map(r => {
      const hasDb = !!r.linked_project_id;
      const hasHosting = !!r.linked_hosting_id;
      return `
        <div class="repo-card" onclick="selectRepo('${this.esc(r.owner_username)}', '${this.esc(r.slug)}')">
          <div class="repo-card-header">
            <div class="repo-info">
              <span class="repo-name">${this.esc(r.name)}</span>
              <span class="repo-owner">${this.esc(r.owner_username)}</span>
            </div>
          </div>
          <div class="repo-tags">
            ${hasDb ? '<span class="tag tag-db">DB</span>' : ''}
            ${hasHosting ? '<span class="tag tag-hosting">Host</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    return this.wrap(`
      <div class="select-repo">
        <div class="sr-header">
          <h2>Select Repository</h2>
        </div>

        ${this.state.loading ? '<div class="loading-bar"></div>' : ''}

        <div class="repo-list">
          ${repos.length === 0 && !this.state.loading ? '<p class="empty-text">No repositories found.</p>' : ''}
          ${repoCards}
        </div>

        <div class="sr-footer">
          <button class="btn-ghost btn-sm" onclick="send('disconnect')">Disconnect</button>
          <button class="btn-ghost btn-sm" onclick="send('refresh')">Refresh</button>
        </div>
      </div>
    `);
  }

  // ─── Dashboard Screen ──────────────────────────────────────

  private renderDashboard(): string {
    const s = this.state;
    const rd = s.repoData;
    const h = s.hosting;
    const hs = s.hostingStatus;
    const dbp = s.dbProject;

    const hostingColor = hs?.status === 'online' ? '#4ade80' :
      hs?.status === 'stopped' ? '#71717a' :
      hs?.status === 'errored' ? '#ef4444' : '#fbbf24';

    const hasDb = !!dbp;
    const hasHosting = !!h;
    const isNode = h?.type && h.type !== 'static';

    const branchOptions = s.branches.map(b =>
      `<option value="${this.esc(b)}" ${b === s.branch ? 'selected' : ''}>${this.esc(b)}</option>`
    ).join('');

    // DB project options (exclude already linked)
    const dbOptions = s.availableDbProjects.map(p =>
      `<option value="${this.esc(p.id)}">${this.esc(p.name)} (${this.esc(p.db_name)})</option>`
    ).join('');

    // Hosting project options
    const hostingOptions = s.availableHostingProjects.map(p =>
      `<option value="${this.esc(p.id)}">${this.esc(p.name)} (${p.type === 'static' ? 'Static' : p.type === 'node' ? 'Node.js' : 'Fullstack'})</option>`
    ).join('');

    // Activity
    const activityHtml = s.activity.slice(0, 5).map(a => {
      const time = this.timeAgo(a.created_at);
      return `<div class="activity-item">
        <span class="activity-text">${this.esc(a.description || a.action)}</span>
        <span class="activity-time">${time}</span>
      </div>`;
    }).join('');

    return this.wrap(`
      <!-- Repo Header -->
      <div class="dash-header">
        <div class="dash-repo">
          <div class="dash-repo-name">${this.esc(s.owner)}/${this.esc(rd?.name || s.repo)}</div>
          <select class="branch-select" onchange="switchBranch(this.value)">
            ${branchOptions || `<option>${this.esc(s.branch)}</option>`}
          </select>
        </div>
        <div class="dash-actions-row">
          <button class="btn-icon-sm" title="Change Repo" onclick="send('changeRepo')">&#x21C4;</button>
          <button class="btn-icon-sm" title="Refresh" onclick="send('refresh')">&#x21BB;</button>
        </div>
      </div>

      ${s.loading ? '<div class="loading-bar"></div>' : ''}

      <!-- Database -->
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:${hasDb ? '#4ade80' : '#71717a'}"></span>
          <span class="section-title">Database</span>
          ${hasDb ? `<button class="btn-link danger" onclick="send('unlinkDb')">Unlink</button>` : ''}
        </div>

        ${hasDb ? `
          <div class="linked-info">
            <span class="linked-name">${this.esc(dbp.name)}</span>
            <span class="linked-meta">${this.esc(dbp.db_name)}</span>
          </div>
          <div class="section-actions">
            <button class="btn-xs" onclick="cmd('vpcSync.pull')">Pull Schema</button>
            <button class="btn-xs" onclick="cmd('vpcSync.pushAll')">Push Migrations</button>
          </div>
        ` : `
          ${s.availableDbProjects.length > 0 ? `
            <div class="connect-row">
              <select id="dbSelect" class="connect-select">
                <option value="">Select project...</option>
                ${dbOptions}
              </select>
              <button class="btn-xs btn-accent" onclick="linkDb()">Connect</button>
            </div>
          ` : `
            <div class="section-empty">No BanaDB projects available</div>
          `}
        `}
      </div>

      <!-- Hosting -->
      <div class="section">
        <div class="section-header">
          <span class="section-dot" style="background:${hasHosting ? hostingColor : '#71717a'}"></span>
          <span class="section-title">Hosting</span>
          ${hasHosting && hs ? `<span class="status-badge" style="color:${hostingColor}">${hs.status || 'unknown'}</span>` : ''}
          ${hasHosting ? `<button class="btn-link danger" onclick="send('unlinkHosting')">Unlink</button>` : ''}
        </div>

        ${hasHosting && h ? `
          <div class="linked-info">
            <span class="linked-name">${this.esc(h.name)}</span>
            <span class="linked-meta">${h.type === 'static' ? 'Static' : h.type === 'node' ? 'Node.js' : 'Fullstack'}${h.slug ? ` / ${this.esc(h.slug)}` : ''}</span>
          </div>
          ${hs?.uptime || hs?.memory ? `
            <div class="hosting-stats">
              ${hs?.uptime ? `<span>${hs.uptime}</span>` : ''}
              ${hs?.memory ? `<span>${hs.memory}</span>` : ''}
            </div>
          ` : ''}
          <div class="section-actions">
            <button class="btn-xs btn-accent" onclick="send('deploy')">Deploy</button>
            ${isNode ? `
              <button class="btn-xs" onclick="hostCtl('restart')">Restart</button>
              ${hs?.status === 'online'
                ? `<button class="btn-xs btn-danger" onclick="hostCtl('stop')">Stop</button>`
                : `<button class="btn-xs" onclick="hostCtl('start')">Start</button>`
              }
            ` : ''}
            <button class="btn-xs" onclick="send('viewLogs')">Logs</button>
          </div>
        ` : `
          ${s.availableHostingProjects.length > 0 ? `
            <div class="connect-row">
              <select id="hostingSelect" class="connect-select">
                <option value="">Select project...</option>
                ${hostingOptions}
              </select>
              <button class="btn-xs btn-accent" onclick="linkHosting()">Connect</button>
            </div>
          ` : `
            <div class="section-empty">No hosting projects available</div>
          `}
        `}
      </div>

      <!-- Activity -->
      ${s.activity.length > 0 ? `
        <div class="activity-section">
          <div class="activity-label">Recent</div>
          <div class="activity-list">${activityHtml}</div>
        </div>
      ` : ''}

      <!-- Footer -->
      <div class="dash-footer">
        <button class="btn-ghost btn-sm" onclick="send('disconnect')">Disconnect</button>
      </div>
    `);
  }

  // ─── Helpers ───────────────────────────────────────────────

  private timeAgo(dateStr: string): string {
    if (!dateStr) { return ''; }
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) { return 'now'; }
    if (mins < 60) { return `${mins}m`; }
    const hours = Math.floor(mins / 60);
    if (hours < 24) { return `${hours}h`; }
    return `${Math.floor(hours / 24)}d`;
  }

  private esc(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private wrap(body: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --radius: 6px;
    --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground);
    --card-bg: var(--vscode-editor-background);
    --card-border: var(--vscode-panel-border);
    --dim: var(--vscode-descriptionForeground);
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--vscode-panel-border));
    --hover: var(--vscode-list-hoverBackground);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-foreground);
    padding: 10px;
    line-height: 1.5;
  }

  /* ─── Welcome / Connect ─── */
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 8px;
    text-align: center;
  }
  .logo { margin-bottom: 12px; }
  .welcome h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { font-size: 11px; color: var(--dim); max-width: 240px; margin-bottom: 20px; }
  .connect-form { width: 100%; max-width: 300px; }
  .field { margin-bottom: 12px; text-align: left; }
  .field label {
    display: block; font-size: 11px; font-weight: 600; color: var(--dim);
    margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .field input {
    width: 100%; padding: 8px 10px; font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    color: var(--input-fg); background: var(--input-bg);
    border: 1px solid var(--input-border); border-radius: var(--radius); outline: none;
  }
  .field input:focus { border-color: var(--vscode-focusBorder); }
  .field input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .error-msg {
    background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25);
    color: #ef4444; border-radius: var(--radius); padding: 8px 10px; font-size: 11px; margin-bottom: 10px;
  }
  .dim { color: var(--dim); }

  /* ─── Buttons ─── */
  button {
    font-family: var(--vscode-font-family); cursor: pointer; border: none;
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    transition: all 0.15s;
  }
  .btn-primary {
    background: var(--accent); color: var(--accent-fg);
    border-radius: var(--radius); font-weight: 600;
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-full { width: 100%; }
  .btn-lg { padding: 10px 16px; font-size: 13px; }
  .btn-xs {
    padding: 3px 8px; font-size: 10px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-radius: 4px; font-weight: 500;
  }
  .btn-xs:hover { opacity: 0.85; }
  .btn-xs.btn-accent { background: var(--accent); color: var(--accent-fg); }
  .btn-xs.btn-danger { background: rgba(239,68,68,0.15); color: #ef4444; }
  .btn-ghost {
    background: none; color: var(--dim); padding: 4px 8px;
    font-size: 11px; border-radius: 4px;
  }
  .btn-ghost:hover { color: var(--vscode-foreground); background: var(--hover); }
  .btn-sm { font-size: 11px; }
  .btn-icon-sm {
    background: none; color: var(--dim); padding: 4px; border-radius: 4px; font-size: 14px;
  }
  .btn-icon-sm:hover { color: var(--vscode-foreground); background: var(--hover); }
  .btn-link {
    background: none; color: var(--dim); font-size: 10px; padding: 0;
  }
  .btn-link:hover { color: var(--vscode-foreground); }
  .btn-link.danger { color: #ef4444; }
  .btn-link.danger:hover { opacity: 0.8; }

  /* ─── Loading ─── */
  .spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
    border-radius: 50%; animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading-bar {
    height: 2px; background: var(--accent); border-radius: 1px;
    margin-bottom: 8px; animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }

  /* ─── Repo Selection ─── */
  .select-repo { padding: 4px 0; }
  .sr-header { margin-bottom: 12px; }
  .sr-header h2 { font-size: 14px; font-weight: 600; }
  .repo-list { display: flex; flex-direction: column; gap: 4px; }
  .repo-card {
    background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: var(--radius); padding: 8px 10px; cursor: pointer;
    display: flex; align-items: center; justify-content: space-between;
  }
  .repo-card:hover { border-color: var(--accent); }
  .repo-info { flex: 1; min-width: 0; }
  .repo-name { display: block; font-weight: 600; font-size: 12px; }
  .repo-owner { display: block; font-size: 10px; color: var(--dim); }
  .repo-tags { display: flex; gap: 3px; }
  .tag { font-size: 9px; font-weight: 600; padding: 1px 5px; border-radius: 3px; }
  .tag-db { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .tag-hosting { background: rgba(168,85,247,0.15); color: #a855f7; }
  .sr-footer {
    display: flex; justify-content: space-between; margin-top: 12px;
    padding-top: 8px; border-top: 1px solid var(--card-border);
  }
  .empty-text { text-align: center; color: var(--dim); font-size: 11px; padding: 24px 0; }

  /* ─── Dashboard ─── */
  .dash-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--card-border);
  }
  .dash-repo { flex: 1; min-width: 0; }
  .dash-repo-name { font-weight: 600; font-size: 12px; margin-bottom: 2px; }
  .branch-select {
    padding: 1px 4px; font-size: 10px;
    font-family: var(--vscode-editor-font-family);
    color: var(--input-fg); background: var(--input-bg);
    border: 1px solid var(--input-border); border-radius: 3px; outline: none;
  }
  .dash-actions-row { display: flex; gap: 2px; }

  /* ─── Sections (Database / Hosting) ─── */
  .section {
    background: var(--card-bg); border: 1px solid var(--card-border);
    border-radius: var(--radius); padding: 8px 10px; margin-bottom: 6px;
  }
  .section-header {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
  }
  .section-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .section-title { font-weight: 600; font-size: 11px; flex: 1; }
  .status-badge { font-size: 10px; font-weight: 600; text-transform: capitalize; }
  .linked-info { padding-left: 12px; margin-bottom: 4px; }
  .linked-name { display: block; font-size: 11px; font-weight: 500; }
  .linked-meta { display: block; font-size: 10px; color: var(--dim); font-family: var(--vscode-editor-font-family); }
  .section-actions { display: flex; gap: 4px; flex-wrap: wrap; padding-left: 12px; margin-top: 4px; }
  .section-empty { font-size: 10px; color: var(--dim); padding-left: 12px; }
  .hosting-stats {
    display: flex; gap: 8px; font-size: 10px; color: var(--dim);
    padding-left: 12px; margin-bottom: 2px;
  }

  /* ─── Connect Row (dropdown + button) ─── */
  .connect-row { display: flex; gap: 4px; padding-left: 12px; margin-top: 2px; }
  .connect-select {
    flex: 1; padding: 3px 6px; font-size: 10px;
    font-family: var(--vscode-editor-font-family);
    color: var(--input-fg); background: var(--input-bg);
    border: 1px solid var(--input-border); border-radius: 4px; outline: none;
    min-width: 0;
  }

  /* ─── Activity ─── */
  .activity-section { margin-bottom: 6px; }
  .activity-label { font-size: 10px; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .activity-list {
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius);
  }
  .activity-item {
    display: flex; align-items: center; gap: 6px; padding: 4px 8px;
    font-size: 10px; border-bottom: 1px solid var(--card-border);
  }
  .activity-item:last-child { border-bottom: none; }
  .activity-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .activity-time { font-size: 9px; color: var(--dim); flex-shrink: 0; }

  /* ─── Footer ─── */
  .dash-footer {
    display: flex; justify-content: center; padding-top: 6px;
    border-top: 1px solid var(--card-border);
  }
</style>
</head>
<body>
${body}

<script>
  const vscode = acquireVsCodeApi();

  function connect() {
    const url = document.getElementById('url')?.value?.trim();
    const token = document.getElementById('token')?.value?.trim();
    if (!url) { return; }
    if (!token) { return; }
    vscode.postMessage({ command: 'connect', url, token });
  }

  function selectRepo(owner, slug) {
    vscode.postMessage({ command: 'selectRepo', owner, slug });
  }

  function switchBranch(branch) {
    vscode.postMessage({ command: 'switchBranch', branch });
  }

  function send(cmd) {
    vscode.postMessage({ command: cmd });
  }

  function cmd(c) {
    vscode.postMessage({ command: 'openCommand', cmd: c });
  }

  function hostCtl(action) {
    vscode.postMessage({ command: 'hostingControl', action });
  }

  function linkDb() {
    const sel = document.getElementById('dbSelect');
    if (sel && sel.value) {
      vscode.postMessage({ command: 'linkDb', projectId: sel.value });
    }
  }

  function linkHosting() {
    const sel = document.getElementById('hostingSelect');
    if (sel && sel.value) {
      vscode.postMessage({ command: 'linkHosting', hostingId: sel.value });
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.getElementById('token')) {
      connect();
    }
  });
</script>
</body>
</html>`;
  }
}
