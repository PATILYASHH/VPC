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
exports.SyncActionsProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
class SyncActionsProvider {
    constructor(client, onAction) {
        this.compareResult = null;
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
                    await this.loadComparison();
                    break;
                case 'commitAndPush':
                    await this.commitAndPush(message.title, message.selectedFiles);
                    break;
                case 'pull':
                    await vscode.commands.executeCommand('vpcSync.pull');
                    break;
                case 'stageFile':
                    await this.stageFileByName(message.fileName);
                    break;
                case 'pushSingle':
                    await this.pushSingleFile(message.fileName, message.title);
                    break;
            }
        });
        // Auto-load comparison on view
        this.loadComparison();
    }
    refresh() {
        this.loadComparison();
    }
    async loadComparison() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!url || !key || !workspaceRoot) {
            this.compareResult = null;
            this.updateView();
            return;
        }
        try {
            const [schema, migrationsResult, prResult] = await Promise.all([
                this.client.getSchema(url, key),
                this.client.getMigrations(url, key, 1, 500),
                this.client.getPullRequests(url, key),
            ]);
            const dbTableNames = new Set(schema.tables.map((t) => t.name));
            const remoteMigrations = migrationsResult.migrations || [];
            const remotePRs = prResult.pull_requests || [];
            // Build checksums for applied migrations and PRs
            const appliedChecksums = new Set();
            for (const m of remoteMigrations) {
                if (m.status !== 'failed') {
                    appliedChecksums.add(crypto.createHash('sha256').update(m.sql_up).digest('hex'));
                }
            }
            const prChecksums = new Set();
            for (const pr of remotePRs) {
                if (pr.status !== 'merged') {
                    prChecksums.add(crypto.createHash('sha256').update(pr.sql_content).digest('hex'));
                }
            }
            // Read local files
            const dir = path.resolve(workspaceRoot, outFolder);
            const sqlFiles = [];
            if (fs.existsSync(dir)) {
                for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
                    const sql = fs.readFileSync(path.join(dir, f), 'utf-8');
                    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
                    sqlFiles.push({ name: f, checksum, sql });
                }
            }
            // Parse local table creates
            const localTableCreates = new Map();
            for (const file of sqlFiles) {
                const upper = file.sql.toUpperCase().replace(/\s+/g, ' ');
                for (const match of upper.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\S+)/g)) {
                    const table = match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, '');
                    if (!table.startsWith('_vpc_')) {
                        localTableCreates.set(table, file.name);
                    }
                }
            }
            // Classify files as pushed/unpushed
            const unstagedFiles = [];
            const stagedFiles = [];
            for (const file of sqlFiles) {
                if (!appliedChecksums.has(file.checksum) && !prChecksums.has(file.checksum)) {
                    unstagedFiles.push(file.name);
                }
            }
            // Tables in local SQL but not in DB
            const newTables = [];
            for (const [table, file] of localTableCreates) {
                if (!dbTableNames.has(table)) {
                    newTables.push({ name: table, file });
                }
            }
            // Tables in DB but not in local SQL
            const missingLocally = [];
            for (const table of dbTableNames) {
                if (!localTableCreates.has(table) && !table.startsWith('_vpc_')) {
                    missingLocally.push(table);
                }
            }
            // Existing tables (in both)
            const existingTables = [];
            for (const table of dbTableNames) {
                if (localTableCreates.has(table) && !table.startsWith('_vpc_')) {
                    existingTables.push(table);
                }
            }
            this.compareResult = {
                existingTables,
                newTables,
                missingLocally,
                stagedFiles,
                unstagedFiles,
                totalDbTables: dbTableNames.size,
                totalLocalFiles: sqlFiles.length,
            };
        }
        catch (err) {
            this.compareResult = null;
        }
        this.updateView();
    }
    async commitAndPush(title, selectedFiles) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!url || !key || !workspaceRoot) {
            vscode.window.showErrorMessage('VPC Sync not configured.');
            return;
        }
        if (!title) {
            vscode.window.showWarningMessage('Please enter a PR title before pushing.');
            return;
        }
        const dir = path.resolve(workspaceRoot, outFolder);
        const filesToPush = selectedFiles && selectedFiles.length > 0
            ? selectedFiles
            : (this.compareResult?.unstagedFiles || []);
        if (filesToPush.length === 0) {
            vscode.window.showInformationMessage('No new migrations to push.');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(`Push ${filesToPush.length} migration(s) as PR to VPSHUB?\n\nTitle: "${title}"`, { modal: true }, 'Push to VPSHUB');
        if (confirm !== 'Push to VPSHUB') {
            return;
        }
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'VPC Sync', cancellable: false }, async (progress) => {
            let pushed = 0;
            let failed = 0;
            for (const fileName of filesToPush) {
                const filePath = path.join(dir, fileName);
                if (!fs.existsSync(filePath)) {
                    continue;
                }
                const prTitle = filesToPush.length === 1 ? title : `${title} — ${fileName}`;
                progress.report({ message: `Pushing ${fileName} (${++pushed}/${filesToPush.length})...` });
                try {
                    const sql = fs.readFileSync(filePath, 'utf-8');
                    const result = await this.client.push(url, key, sql, prTitle);
                    if (result.pull_request) {
                        vscode.window.showInformationMessage(`PR #${result.pull_request.pr_number} created: "${result.pull_request.title}"`);
                    }
                }
                catch (err) {
                    failed++;
                    vscode.window.showErrorMessage(`Push failed for ${fileName}: ${err.message}`);
                }
            }
            if (failed === 0) {
                vscode.window.showInformationMessage(`Successfully pushed ${filesToPush.length} migration(s) as PR(s) to VPSHUB!`);
            }
            this.onAction();
            await this.loadComparison();
        });
    }
    async pushSingleFile(fileName, title) {
        await this.commitAndPush(title || fileName.replace('.sql', ''), [fileName]);
    }
    async stageFileByName(fileName) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return;
        }
        const filePath = path.join(path.resolve(workspaceRoot, outFolder), fileName);
        const uri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vpcSync.stage', { resourceUri: uri });
        this.onAction();
    }
    updateView() {
        if (this._view) {
            this._view.webview.html = this.getHtml();
        }
    }
    getHtml() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const isConnected = !!(config.get('serverUrl') && config.get('apiKey'));
        const r = this.compareResult;
        if (!isConnected) {
            return this.wrapHtml(`
        <div class="empty-state">
          <div class="empty-icon">$(database)</div>
          <h3>VPC Sync</h3>
          <p>Connect to your BanaDB project to start syncing database schemas.</p>
          <button class="btn-primary btn-full" onclick="vscode.postMessage({command:'openConfig'})">
            Configure Connection
          </button>
        </div>
      `, false);
        }
        if (!r) {
            return this.wrapHtml(`
        <div class="loading">
          <p>Loading schema comparison...</p>
          <button class="btn-secondary btn-full" onclick="vscode.postMessage({command:'refresh'})">
            Refresh
          </button>
        </div>
      `, true);
        }
        const hasUnpushed = r.unstagedFiles.length > 0;
        const hasNewTables = r.newTables.length > 0;
        const hasMissing = r.missingLocally.length > 0;
        const inSync = !hasUnpushed && !hasNewTables && !hasMissing;
        let filesHtml = '';
        if (hasUnpushed) {
            filesHtml = r.unstagedFiles.map((f, i) => `
        <label class="file-item">
          <input type="checkbox" checked value="${this.esc(f)}" class="file-check" />
          <span class="file-icon">$(file-code)</span>
          <span class="file-name">${this.esc(f)}</span>
          <button class="btn-icon" title="Push this file only" onclick="pushSingle('${this.esc(f)}')">$(cloud-upload)</button>
        </label>
      `).join('');
        }
        let tableCompareHtml = '';
        if (hasNewTables) {
            tableCompareHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-green">${r.newTables.length}</span>
            <span>New Tables (not in DB yet)</span>
          </div>
          <div class="table-list">
            ${r.newTables.map(t => `
              <div class="table-item new">
                <span class="table-icon">$(diff-added)</span>
                <span>${this.esc(t.name)}</span>
                <span class="table-source">${this.esc(t.file)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
        }
        if (r.existingTables.length > 0) {
            tableCompareHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-blue">${r.existingTables.length}</span>
            <span>Existing Tables (already in DB)</span>
          </div>
          <div class="table-list collapsed" id="existingTables">
            ${r.existingTables.slice(0, 10).map(t => `
              <div class="table-item existing">
                <span class="table-icon">$(pass-filled)</span>
                <span>${this.esc(t)}</span>
              </div>
            `).join('')}
            ${r.existingTables.length > 10 ? `<div class="table-item muted">...and ${r.existingTables.length - 10} more</div>` : ''}
          </div>
          <button class="btn-link" onclick="toggleSection('existingTables')">Show/Hide</button>
        </div>
      `;
        }
        if (hasMissing) {
            tableCompareHtml += `
        <div class="section">
          <div class="section-header">
            <span class="badge badge-yellow">${r.missingLocally.length}</span>
            <span>In DB but no local SQL</span>
          </div>
          <div class="table-list">
            ${r.missingLocally.map(t => `
              <div class="table-item missing">
                <span class="table-icon">$(warning)</span>
                <span>${this.esc(t)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
        }
        return this.wrapHtml(`
      <!-- Status Summary -->
      <div class="summary">
        <div class="summary-row">
          <span>DB Tables</span>
          <span class="value">${r.totalDbTables}</span>
        </div>
        <div class="summary-row">
          <span>Local Files</span>
          <span class="value">${r.totalLocalFiles}</span>
        </div>
        <div class="summary-row ${hasUnpushed ? 'highlight' : ''}">
          <span>Unpushed</span>
          <span class="value">${r.unstagedFiles.length}</span>
        </div>
      </div>

      ${inSync ? `
        <div class="sync-status synced">
          <span>$(check)</span> Everything is in sync!
        </div>
      ` : ''}

      <!-- Commit & Push Section -->
      ${hasUnpushed ? `
        <div class="commit-section">
          <div class="section-title">Commit & Push to VPSHUB</div>
          <input type="text" id="prTitle" class="input-full" placeholder="PR title (e.g. Add users table)" />

          <div class="files-header">
            <label>
              <input type="checkbox" id="selectAll" checked onchange="toggleAll()" />
              <strong>Select files to push (${r.unstagedFiles.length})</strong>
            </label>
          </div>
          <div class="file-list">
            ${filesHtml}
          </div>

          <div class="btn-row">
            <button class="btn-primary btn-full btn-large" onclick="commitAndPush()">
              <span class="btn-icon-left">$(cloud-upload)</span>
              Push as PR to VPSHUB
            </button>
          </div>
        </div>
      ` : ''}

      <!-- Pull Section -->
      <div class="pull-section">
        <button class="btn-secondary btn-full" onclick="vscode.postMessage({command:'pull'})">
          <span class="btn-icon-left">$(cloud-download)</span>
          Pull from Database
        </button>
      </div>

      <!-- Table Comparison -->
      ${tableCompareHtml ? `
        <div class="separator"></div>
        <div class="compare-title">Table Comparison</div>
        ${tableCompareHtml}
      ` : ''}

      <!-- Refresh -->
      <div class="refresh-row">
        <button class="btn-link" onclick="vscode.postMessage({command:'refresh'})">$(refresh) Refresh</button>
      </div>
    `, true);
    }
    wrapHtml(body, connected) {
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
    line-height: 1.5;
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: 24px 12px;
  }
  .empty-state h3 { margin: 8px 0; font-size: 14px; }
  .empty-state p {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 16px;
  }
  .loading { text-align: center; padding: 24px; }
  .loading p {
    color: var(--vscode-descriptionForeground);
    margin-bottom: 12px;
  }

  /* Summary */
  .summary {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 12px;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11px;
  }
  .summary-row .value {
    font-weight: 600;
    font-family: var(--vscode-editor-font-family);
  }
  .summary-row.highlight {
    color: var(--vscode-editorWarning-foreground, #e5c07b);
  }

  /* Sync status */
  .sync-status {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sync-status.synced {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.25);
    color: #22c55e;
  }

  /* Commit section */
  .commit-section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 12px;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .input-full {
    width: 100%;
    padding: 8px 10px;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: 4px;
    outline: none;
    margin-bottom: 10px;
  }
  .input-full:focus {
    border-color: var(--vscode-focusBorder);
  }
  .input-full::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  /* Files */
  .files-header {
    font-size: 11px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .files-header label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .file-list {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    font-size: 11px;
    cursor: pointer;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .file-item:last-child { border-bottom: none; }
  .file-item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .file-name {
    flex: 1;
    font-family: var(--vscode-editor-font-family);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-check { flex-shrink: 0; }
  .btn-icon {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    opacity: 0.7;
    font-size: 12px;
  }
  .btn-icon:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  /* Buttons */
  .btn-row { margin-top: 8px; }
  button {
    padding: 7px 12px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .btn-full { width: 100%; }
  .btn-large {
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
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
  .btn-link {
    background: none;
    border: none;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    font-size: 11px;
    padding: 4px 0;
  }
  .btn-link:hover { text-decoration: underline; }

  /* Pull section */
  .pull-section { margin-bottom: 12px; }

  /* Separator */
  .separator {
    border-top: 1px solid var(--vscode-panel-border);
    margin: 12px 0;
  }

  /* Table comparison */
  .compare-title {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .section { margin-bottom: 10px; }
  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-bottom: 4px;
    font-weight: 500;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    font-size: 10px;
    font-weight: 600;
  }
  .badge-green {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }
  .badge-blue {
    background: rgba(59, 130, 246, 0.15);
    color: #3b82f6;
  }
  .badge-yellow {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }
  .table-list { margin-left: 4px; }
  .table-list.collapsed { display: none; }
  .table-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family);
  }
  .table-item.muted {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .table-source {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
    margin-left: auto;
  }

  /* Refresh */
  .refresh-row {
    text-align: center;
    margin-top: 8px;
  }
</style>
</head>
<body>
${body}

<script>
  const vscode = acquireVsCodeApi();

  function commitAndPush() {
    const title = document.getElementById('prTitle')?.value?.trim();
    if (!title) {
      alert('Please enter a PR title');
      return;
    }
    const checks = document.querySelectorAll('.file-check:checked');
    const selectedFiles = Array.from(checks).map(c => c.value);
    vscode.postMessage({ command: 'commitAndPush', title, selectedFiles });
  }

  function pushSingle(fileName) {
    const title = document.getElementById('prTitle')?.value?.trim() || fileName.replace('.sql', '');
    vscode.postMessage({ command: 'pushSingle', fileName, title });
  }

  function toggleAll() {
    const selectAll = document.getElementById('selectAll');
    const checks = document.querySelectorAll('.file-check');
    checks.forEach(c => { c.checked = selectAll.checked; });
  }

  function toggleSection(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.toggle('collapsed'); }
  }
</script>
</body>
</html>`;
    }
    esc(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
}
exports.SyncActionsProvider = SyncActionsProvider;
SyncActionsProvider.viewType = 'vpcSync.syncActions';
//# sourceMappingURL=syncActionsProvider.js.map