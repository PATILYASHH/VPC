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
exports.RepoChangesProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
class RepoChangesProvider {
    constructor(client, onAction) {
        this.state = {
            connected: false,
            changes: [],
            newMigrations: [],
            totalRemote: 0,
            totalLocal: 0,
            dbConnected: false,
        };
        this.client = client;
        this.onAction = onAction;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'refresh':
                    await this.loadState();
                    break;
                case 'pull':
                    await this.pullFromVpshub();
                    break;
                case 'pullFile':
                    await this.pullSingleFile(message.filePath);
                    break;
                case 'runMigrations':
                    await this.runNewMigrations();
                    break;
                case 'openFile':
                    await this.openLocalFile(message.filePath);
                    break;
                case 'testDb':
                    await this.testDbConnection();
                    break;
            }
        });
        this.loadState();
    }
    refresh() {
        this.loadState();
    }
    async loadState() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const baseUrl = config.get('vpshubUrl');
        const token = config.get('vpshubToken');
        const owner = config.get('vpshubOwner');
        const repo = config.get('vpshubRepo');
        const branch = config.get('vpshubBranch') || 'main';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!baseUrl || !token || !owner || !repo || !workspaceRoot) {
            this.state = { connected: false, changes: [], newMigrations: [], totalRemote: 0, totalLocal: 0, dbConnected: false };
            this.updateView();
            return;
        }
        try {
            // Get remote manifest
            const manifest = await this.client.vpshubGetManifest(baseUrl, token, owner, repo, branch);
            const remoteFiles = new Map();
            for (const f of manifest.files) {
                remoteFiles.set(f.path, { hash: f.hash, size: f.size });
            }
            // Scan local files
            const localFiles = new Map();
            this.scanLocalFiles(workspaceRoot, '', localFiles);
            // Compare: find changed, added, deleted, and new migrations
            const changes = [];
            const newMigrations = [];
            // Files in remote but not local (or modified)
            for (const [remotePath, remoteInfo] of remoteFiles) {
                const localHash = localFiles.get(remotePath);
                if (!localHash) {
                    const change = {
                        path: remotePath,
                        status: 'added',
                        remoteHash: remoteInfo.hash,
                        size: remoteInfo.size,
                        isMigration: this.isMigrationFile(remotePath),
                    };
                    changes.push(change);
                    if (change.isMigration) {
                        newMigrations.push(remotePath);
                    }
                }
                else if (localHash !== remoteInfo.hash) {
                    const change = {
                        path: remotePath,
                        status: 'modified',
                        localHash,
                        remoteHash: remoteInfo.hash,
                        size: remoteInfo.size,
                        isMigration: this.isMigrationFile(remotePath),
                    };
                    changes.push(change);
                    if (change.isMigration) {
                        newMigrations.push(remotePath);
                    }
                }
            }
            // Files in local but not remote (local only - not deleted, just extra)
            for (const [localPath, localHash] of localFiles) {
                if (!remoteFiles.has(localPath)) {
                    changes.push({
                        path: localPath,
                        status: 'deleted', // exists locally but not in remote = local-only / to push
                        localHash,
                        isMigration: this.isMigrationFile(localPath),
                    });
                }
            }
            // Sort: migrations first, then by path
            changes.sort((a, b) => {
                if (a.isMigration && !b.isMigration)
                    return -1;
                if (!a.isMigration && b.isMigration)
                    return 1;
                return a.path.localeCompare(b.path);
            });
            // Check DB connection
            const dbName = config.get('dbName');
            const dbConnected = !!dbName;
            // Load saved SHA
            const savedSha = vscode.workspace.getConfiguration('vpcSync').get('_lastSyncSha') || '';
            this.state = {
                connected: true,
                remoteSha: manifest.sha,
                localSha: savedSha,
                owner,
                repo,
                branch,
                changes,
                newMigrations,
                totalRemote: manifest.total,
                totalLocal: localFiles.size,
                dbConnected,
                dbName,
            };
        }
        catch (err) {
            this.state = {
                connected: false,
                changes: [],
                newMigrations: [],
                totalRemote: 0,
                totalLocal: 0,
                dbConnected: false,
            };
            vscode.window.showErrorMessage(`VPSHUB sync failed: ${err.message}`);
        }
        this.updateView();
    }
    scanLocalFiles(dir, prefix, result) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                // Skip common non-project dirs
                if (['node_modules', '.git', '.vscode', 'dist', 'out', '__pycache__', '.next'].includes(entry.name))
                    continue;
                const fullPath = path.join(dir, entry.name);
                const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    this.scanLocalFiles(fullPath, relativePath, result);
                }
                else if (entry.isFile()) {
                    try {
                        const content = fs.readFileSync(fullPath);
                        // Use git-compatible hash: blob <size>\0<content>
                        const header = `blob ${content.length}\0`;
                        const hash = crypto.createHash('sha1').update(header).update(content).digest('hex');
                        result.set(relativePath, hash);
                    }
                    catch { /* skip unreadable */ }
                }
            }
        }
        catch { /* skip unreadable dirs */ }
    }
    isMigrationFile(filePath) {
        return /migrations?\//i.test(filePath) && filePath.endsWith('.sql');
    }
    async pullFromVpshub() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const baseUrl = config.get('vpshubUrl');
        const token = config.get('vpshubToken');
        const owner = config.get('vpshubOwner');
        const repo = config.get('vpshubRepo');
        const branch = config.get('vpshubBranch') || 'main';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot)
            return;
        const filesToPull = this.state.changes.filter(c => c.status === 'added' || c.status === 'modified');
        if (filesToPull.length === 0) {
            vscode.window.showInformationMessage('All files are up to date!');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Pull ${filesToPull.length} file(s) from VPSHUB? This will overwrite local files.`, { modal: true }, 'Pull Files');
        if (confirm !== 'Pull Files')
            return;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'VPSHUB Pull' }, async (progress) => {
            let pulled = 0;
            for (const file of filesToPull) {
                progress.report({ message: `${file.path} (${++pulled}/${filesToPull.length})` });
                try {
                    const result = await this.client.vpshubGetFileContent(baseUrl, token, owner, repo, branch, file.path);
                    const localPath = path.join(workspaceRoot, file.path);
                    fs.mkdirSync(path.dirname(localPath), { recursive: true });
                    fs.writeFileSync(localPath, result.content, 'utf-8');
                }
                catch (err) {
                    vscode.window.showErrorMessage(`Failed to pull ${file.path}: ${err.message}`);
                }
            }
            // Save sync SHA
            if (this.state.remoteSha) {
                await config.update('_lastSyncSha', this.state.remoteSha, vscode.ConfigurationTarget.Workspace);
            }
            vscode.window.showInformationMessage(`Pulled ${pulled} file(s) from VPSHUB.`);
            // Check for new migrations and offer to run them
            const newMigs = filesToPull.filter(f => this.isMigrationFile(f.path));
            if (newMigs.length > 0 && this.state.dbConnected) {
                const autoRun = config.get('autoRunMigrations');
                if (autoRun) {
                    await this.runNewMigrations();
                }
                else {
                    const runNow = await vscode.window.showInformationMessage(`${newMigs.length} new migration(s) detected. Run them now?`, 'Run Migrations', 'Later');
                    if (runNow === 'Run Migrations') {
                        await this.runNewMigrations();
                    }
                }
            }
            this.onAction();
            await this.loadState();
        });
    }
    async pullSingleFile(filePath) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const baseUrl = config.get('vpshubUrl');
        const token = config.get('vpshubToken');
        const owner = config.get('vpshubOwner');
        const repo = config.get('vpshubRepo');
        const branch = config.get('vpshubBranch') || 'main';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot)
            return;
        try {
            const result = await this.client.vpshubGetFileContent(baseUrl, token, owner, repo, branch, filePath);
            const localPath = path.join(workspaceRoot, filePath);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, result.content, 'utf-8');
            vscode.window.showInformationMessage(`Pulled: ${filePath}`);
            const doc = await vscode.workspace.openTextDocument(localPath);
            await vscode.window.showTextDocument(doc, { preview: true });
            await this.loadState();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to pull ${filePath}: ${err.message}`);
        }
    }
    async openLocalFile(filePath) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot)
            return;
        const localPath = path.join(workspaceRoot, filePath);
        if (fs.existsSync(localPath)) {
            const doc = await vscode.workspace.openTextDocument(localPath);
            await vscode.window.showTextDocument(doc, { preview: true });
        }
    }
    async runNewMigrations() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const dbHost = config.get('dbHost') || 'localhost';
        const dbPort = config.get('dbPort') || 5432;
        const dbName = config.get('dbName');
        const dbUser = config.get('dbUser');
        const dbPassword = config.get('dbPassword');
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!dbName || !dbUser || !workspaceRoot) {
            vscode.window.showErrorMessage('Database not configured. Set dbName, dbUser, dbPassword in VPC Sync settings.');
            return;
        }
        // Find migration files
        const migDirs = ['migrations', 'backend/migrations', 'db/migrations'];
        let migDir = '';
        for (const dir of migDirs) {
            const fullDir = path.join(workspaceRoot, dir);
            if (fs.existsSync(fullDir)) {
                migDir = fullDir;
                break;
            }
        }
        if (!migDir) {
            vscode.window.showWarningMessage('No migrations folder found.');
            return;
        }
        const sqlFiles = fs.readdirSync(migDir)
            .filter(f => f.endsWith('.sql'))
            .sort();
        if (sqlFiles.length === 0) {
            vscode.window.showInformationMessage('No migration files found.');
            return;
        }
        // Run migrations using psql or pg client
        const terminal = vscode.window.createTerminal({
            name: 'VPC Migrations',
            env: { PGPASSWORD: dbPassword },
        });
        terminal.show();
        let cmd = '';
        for (const file of sqlFiles) {
            const filePath = path.join(migDir, file).replace(/\\/g, '/');
            cmd += `echo "Running: ${file}" && psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -f "${filePath}" 2>&1 && `;
        }
        cmd += 'echo "All migrations complete!"';
        terminal.sendText(cmd);
        vscode.window.showInformationMessage(`Running ${sqlFiles.length} migration(s) on ${dbName}...`);
    }
    async testDbConnection() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const dbHost = config.get('dbHost') || 'localhost';
        const dbPort = config.get('dbPort') || 5432;
        const dbName = config.get('dbName');
        const dbUser = config.get('dbUser');
        const dbPassword = config.get('dbPassword');
        if (!dbName || !dbUser) {
            vscode.window.showErrorMessage('Set dbName and dbUser in VPC Sync settings first.');
            return;
        }
        const terminal = vscode.window.createTerminal({
            name: 'DB Test',
            env: { PGPASSWORD: dbPassword },
        });
        terminal.show();
        terminal.sendText(`psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d ${dbName} -c "SELECT current_database(), now();" 2>&1`);
    }
    updateView() {
        if (this._view) {
            this._view.webview.html = this.getHtml();
        }
    }
    getHtml() {
        const s = this.state;
        if (!s.connected) {
            return this.wrapHtml(`
        <div class="empty-state">
          <h3>VPSHUB Repo Sync</h3>
          <p>Connect to a VPSHUB repository to track file changes, pull code, and auto-run migrations.</p>
          <p class="hint">Set vpshubUrl, vpshubToken, vpshubOwner, vpshubRepo in settings.</p>
          <button class="btn-primary btn-full" onclick="vscode.postMessage({command:'refresh'})">Refresh</button>
        </div>
      `);
        }
        const added = s.changes.filter(c => c.status === 'added');
        const modified = s.changes.filter(c => c.status === 'modified');
        const localOnly = s.changes.filter(c => c.status === 'deleted');
        const inSync = added.length === 0 && modified.length === 0;
        let changesHtml = '';
        if (added.length > 0) {
            changesHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-green">${added.length}</span>
            <span>New Files (remote only)</span>
          </div>
          <div class="file-list">
            ${added.map(f => this.fileItemHtml(f, 'A', 'green')).join('')}
          </div>
        </div>
      `;
        }
        if (modified.length > 0) {
            changesHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-yellow">${modified.length}</span>
            <span>Modified Files</span>
          </div>
          <div class="file-list">
            ${modified.map(f => this.fileItemHtml(f, 'M', 'yellow')).join('')}
          </div>
        </div>
      `;
        }
        if (localOnly.length > 0) {
            changesHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-blue">${localOnly.length}</span>
            <span>Local Only (not in remote)</span>
          </div>
          <div class="file-list collapsed" id="localOnly">
            ${localOnly.slice(0, 20).map(f => this.fileItemHtml(f, 'L', 'blue')).join('')}
            ${localOnly.length > 20 ? `<div class="file-item muted">...and ${localOnly.length - 20} more</div>` : ''}
          </div>
          <button class="btn-link" onclick="toggleSection('localOnly')">Show/Hide</button>
        </div>
      `;
        }
        return this.wrapHtml(`
      <!-- Header -->
      <div class="summary">
        <div class="summary-row">
          <span>Repo</span>
          <span class="value">${this.esc(s.owner || '')}/${this.esc(s.repo || '')}</span>
        </div>
        <div class="summary-row">
          <span>Branch</span>
          <span class="value">${this.esc(s.branch || 'main')}</span>
        </div>
        <div class="summary-row">
          <span>Remote Files</span>
          <span class="value">${s.totalRemote}</span>
        </div>
        <div class="summary-row">
          <span>Local Files</span>
          <span class="value">${s.totalLocal}</span>
        </div>
        <div class="summary-row">
          <span>DB</span>
          <span class="value ${s.dbConnected ? '' : 'warn'}">${s.dbConnected ? s.dbName : 'Not configured'}</span>
        </div>
      </div>

      ${inSync ? `
        <div class="sync-status synced">Everything is in sync with VPSHUB!</div>
      ` : `
        <div class="sync-status pending">
          ${added.length + modified.length} file(s) need to be pulled
        </div>
      `}

      <!-- Pull All -->
      ${!inSync ? `
        <div class="pull-section">
          <button class="btn-primary btn-full btn-large" onclick="vscode.postMessage({command:'pull'})">
            Pull ${added.length + modified.length} File(s) from VPSHUB
          </button>
        </div>
      ` : ''}

      <!-- New Migrations -->
      ${s.newMigrations.length > 0 ? `
        <div class="migration-section">
          <div class="section-header">
            <span class="badge badge-orange">${s.newMigrations.length}</span>
            <span>New Migrations Detected</span>
          </div>
          <div class="migration-list">
            ${s.newMigrations.map(m => `<div class="migration-item">${this.esc(m.split('/').pop() || m)}</div>`).join('')}
          </div>
          ${s.dbConnected ? `
            <button class="btn-secondary btn-full" onclick="vscode.postMessage({command:'runMigrations'})">
              Run Migrations on ${this.esc(s.dbName || 'DB')}
            </button>
          ` : `
            <button class="btn-secondary btn-full" onclick="vscode.postMessage({command:'testDb'})">
              Configure DB to Run Migrations
            </button>
          `}
        </div>
      ` : ''}

      <!-- Changed Files -->
      ${changesHtml}

      <!-- Refresh -->
      <div class="refresh-row">
        <button class="btn-link" onclick="vscode.postMessage({command:'refresh'})">Refresh</button>
      </div>
    `);
    }
    fileItemHtml(file, badge, color) {
        const fileName = file.path.split('/').pop() || file.path;
        const dirPath = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
        const sizeStr = file.size ? `${(file.size / 1024).toFixed(1)}KB` : '';
        return `
      <div class="file-item">
        <span class="file-badge file-badge-${color}">${badge}</span>
        <span class="file-info">
          <span class="file-name">${this.esc(fileName)}</span>
          ${dirPath ? `<span class="file-dir">${this.esc(dirPath)}</span>` : ''}
        </span>
        <span class="file-size">${sizeStr}</span>
        ${file.status !== 'deleted' ? `
          <button class="btn-icon" title="Pull this file" onclick="vscode.postMessage({command:'pullFile',filePath:'${this.esc(file.path)}'})">&#x2193;</button>
        ` : `
          <button class="btn-icon" title="Open" onclick="vscode.postMessage({command:'openFile',filePath:'${this.esc(file.path)}'})">&#x2197;</button>
        `}
      </div>
    `;
    }
    wrapHtml(body) {
        return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; line-height: 1.5; }
  .empty-state { text-align: center; padding: 24px 12px; }
  .empty-state h3 { margin: 8px 0; font-size: 14px; }
  .empty-state p { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  .hint { font-size: 10px; color: var(--vscode-descriptionForeground); }

  .summary { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; }
  .summary-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
  .summary-row .value { font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .summary-row .value.warn { color: var(--vscode-editorWarning-foreground, #e5c07b); }

  .sync-status { padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; text-align: center; }
  .sync-status.synced { background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.25); color: #22c55e; }
  .sync-status.pending { background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.25); color: #eab308; }

  .pull-section, .migration-section { margin-bottom: 12px; }
  .migration-section { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; margin-bottom: 12px; }
  .migration-list { margin: 6px 0; }
  .migration-item { font-size: 11px; font-family: var(--vscode-editor-font-family); padding: 2px 6px; color: var(--vscode-descriptionForeground); }

  .section { margin-bottom: 10px; }
  .section-header { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px; font-weight: 500; }
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; font-size: 10px; font-weight: 600; }
  .badge-green { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
  .badge-yellow { background: rgba(234, 179, 8, 0.15); color: #eab308; }
  .badge-blue { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
  .badge-orange { background: rgba(249, 115, 22, 0.15); color: #f97316; }

  .file-list { border: 1px solid var(--vscode-panel-border); border-radius: 4px; max-height: 300px; overflow-y: auto; }
  .file-list.collapsed { display: none; }
  .file-item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; font-size: 11px; border-bottom: 1px solid var(--vscode-panel-border); }
  .file-item:last-child { border-bottom: none; }
  .file-item:hover { background: var(--vscode-list-hoverBackground); }
  .file-item.muted { color: var(--vscode-descriptionForeground); font-style: italic; }
  .file-badge { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 3px; font-size: 9px; font-weight: 700; flex-shrink: 0; }
  .file-badge-green { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
  .file-badge-yellow { background: rgba(234, 179, 8, 0.2); color: #eab308; }
  .file-badge-blue { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
  .file-info { flex: 1; min-width: 0; }
  .file-name { display: block; font-family: var(--vscode-editor-font-family); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-dir { display: block; font-size: 10px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-size { font-size: 10px; color: var(--vscode-descriptionForeground); flex-shrink: 0; }

  button { padding: 7px 12px; font-size: 12px; font-family: var(--vscode-font-family); border: none; border-radius: 4px; cursor: pointer; font-weight: 500; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .btn-full { width: 100%; }
  .btn-large { padding: 10px 16px; font-size: 13px; font-weight: 600; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-top: 6px; }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-link { background: none; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; font-size: 11px; padding: 4px 0; }
  .btn-link:hover { text-decoration: underline; }
  .btn-icon { background: none; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 2px 4px; border-radius: 3px; opacity: 0.7; font-size: 14px; flex-shrink: 0; }
  .btn-icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .refresh-row { text-align: center; margin-top: 8px; }
</style>
</head><body>
${body}
<script>
  const vscode = acquireVsCodeApi();
  function toggleSection(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('collapsed');
  }
</script>
</body></html>`;
    }
    esc(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
exports.RepoChangesProvider = RepoChangesProvider;
RepoChangesProvider.viewType = 'vpcSync.repoChanges';
//# sourceMappingURL=repoChangesProvider.js.map