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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const client_1 = require("./api/client");
const vpcScmProvider_1 = require("./scm/vpcScmProvider");
const fileDecorationProvider_1 = require("./scm/fileDecorationProvider");
const quickDiffProvider_1 = require("./scm/quickDiffProvider");
const historyProvider_1 = require("./views/historyProvider");
const configViewProvider_1 = require("./views/configViewProvider");
const pullRequestsProvider_1 = require("./views/pullRequestsProvider");
const syncActionsProvider_1 = require("./views/syncActionsProvider");
const pull_1 = require("./commands/pull");
const push_1 = require("./commands/push");
const stage_1 = require("./commands/stage");
const newMigration_1 = require("./commands/newMigration");
function activate(context) {
    const client = new client_1.SyncApiClient();
    // ─── SCM Provider (native Source Control panel) ───────────
    const fileDecorationProvider = new fileDecorationProvider_1.VpcFileDecorationProvider();
    const originalContentProvider = new quickDiffProvider_1.VpcOriginalContentProvider();
    const scmProvider = new vpcScmProvider_1.VpcScmProvider(client, context, fileDecorationProvider, originalContentProvider);
    context.subscriptions.push(scmProvider, vscode.window.registerFileDecorationProvider(fileDecorationProvider), vscode.workspace.registerTextDocumentContentProvider('vpc-original', originalContentProvider));
    // ─── Supplementary tree views (VPC Sync panel) ────────────
    const historyProvider = new historyProvider_1.HistoryProvider(client);
    const pullRequestsProvider = new pullRequestsProvider_1.PullRequestsProvider(client);
    const configViewProvider = new configViewProvider_1.ConfigViewProvider(client, () => refreshAll());
    const syncActionsProvider = new syncActionsProvider_1.SyncActionsProvider(client, () => refreshAll());
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(syncActionsProvider_1.SyncActionsProvider.viewType, syncActionsProvider), vscode.window.registerWebviewViewProvider(configViewProvider_1.ConfigViewProvider.viewType, configViewProvider), vscode.window.registerTreeDataProvider('vpcSync.pullRequests', pullRequestsProvider), vscode.window.registerTreeDataProvider('vpcSync.history', historyProvider));
    function refreshAll() {
        scmProvider.refresh();
        historyProvider.refresh();
        pullRequestsProvider.refresh();
        configViewProvider.refresh();
        syncActionsProvider.refresh();
    }
    // ─── Stage/Unstage commands ───────────────────────────────
    (0, stage_1.registerStageCommands)(context, scmProvider);
    // ─── File system watcher ──────────────────────────────────
    const migrationWatcher = vscode.workspace.createFileSystemWatcher('**/migrations/*.sql');
    migrationWatcher.onDidChange(() => scmProvider.refresh());
    migrationWatcher.onDidCreate(() => scmProvider.refresh());
    migrationWatcher.onDidDelete(() => scmProvider.refresh());
    context.subscriptions.push(migrationWatcher);
    // ─── Commands ─────────────────────────────────────────────
    context.subscriptions.push(
    // Config
    vscode.commands.registerCommand('vpcSync.configure', () => {
        vscode.commands.executeCommand('vpcSync.config.focus');
    }), 
    // Pull / Push
    vscode.commands.registerCommand('vpcSync.pull', () => (0, pull_1.pullCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.pullAll', () => (0, pull_1.pullCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.push', () => (0, push_1.pushCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.pushAll', () => (0, push_1.pushAllCommand)(client, scmProvider, () => refreshAll())), vscode.commands.registerCommand('vpcSync.pushFile', (resource) => {
        const filePath = resource?.resourceUri?.fsPath || resource?.filePath;
        (0, push_1.pushCommand)(client, () => refreshAll(), filePath);
    }), 
    // New migration
    vscode.commands.registerCommand('vpcSync.newMigration', () => (0, newMigration_1.newMigrationCommand)()), 
    // Refresh / Status
    vscode.commands.registerCommand('vpcSync.refresh', () => refreshAll()), vscode.commands.registerCommand('vpcSync.status', () => showStatus(client)), vscode.commands.registerCommand('vpcSync.selectFolder', () => selectOutputFolder()), 
    // SQL viewer
    vscode.commands.registerCommand('vpcSync.showSQL', (sql) => showSQL(sql)), 
    // Diff commands
    vscode.commands.registerCommand('vpcSync.openResourceDiff', (uri) => {
        const originalUri = vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
        vscode.commands.executeCommand('vscode.diff', originalUri, uri, `${path.basename(uri.fsPath)} (Remote \u2194 Local)`);
    }), vscode.commands.registerCommand('vpcSync.diffWithRemote', (resource) => {
        const uri = resource.resourceUri;
        const originalUri = vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
        vscode.commands.executeCommand('vscode.diff', originalUri, uri, `${path.basename(uri.fsPath)} (Remote \u2194 Local)`);
    }), vscode.commands.registerCommand('vpcSync.openFile', (resource) => {
        vscode.commands.executeCommand('vscode.open', resource.resourceUri);
    }), 
    // Detect changes
    vscode.commands.registerCommand('vpcSync.detectChanges', () => detectChanges(client, scmProvider, () => refreshAll())), 
    // Sync Actions panel commands
    vscode.commands.registerCommand('vpcSync.commitAndPush', () => {
        vscode.commands.executeCommand('vpcSync.syncActions.focus');
    }), vscode.commands.registerCommand('vpcSync.pullDatabase', () => (0, pull_1.pullCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.compareSchema', () => detectChanges(client, scmProvider, () => refreshAll())));
    // ─── Auto-refresh ─────────────────────────────────────────
    const intervalSec = vscode.workspace.getConfiguration('vpcSync').get('autoRefreshInterval') || 30;
    if (intervalSec > 0) {
        const interval = setInterval(() => refreshAll(), intervalSec * 1000);
        context.subscriptions.push({ dispose: () => clearInterval(interval) });
    }
    refreshAll();
}
// ─── Helper functions ─────────────────────────────────────────
async function showStatus(client) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        vscode.window.showWarningMessage('VPC Sync not configured.');
        return;
    }
    try {
        const status = await client.getStatus(url, key);
        vscode.window.showInformationMessage(`Project: ${status.project.name} | Tracking: ${status.tracking_enabled ? 'ON' : 'OFF'} | Pending: ${status.pending_changes} | Migrations: ${status.total_migrations}`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Status failed: ${err.message}`);
    }
}
async function selectOutputFolder() {
    const uri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Migration Output Folder',
    });
    if (uri?.[0]) {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const relativePath = vscode.workspace.asRelativePath(uri[0]);
        await config.update('outputFolder', relativePath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Output folder set to: ${relativePath}`);
    }
}
async function showSQL(sql) {
    const doc = await vscode.workspace.openTextDocument({ content: sql, language: 'sql' });
    await vscode.window.showTextDocument(doc, { preview: true });
}
async function detectChanges(client, scmProvider, onComplete) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        vscode.window.showWarningMessage('VPC Sync not configured.');
        return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'VPC Sync', cancellable: false }, async (progress) => {
        progress.report({ message: 'Comparing local files with database schema...' });
        try {
            const [schema, migrationsResult] = await Promise.all([
                client.getSchema(url, key),
                client.getMigrations(url, key, 1, 500),
            ]);
            const dbTableNames = new Set(schema.tables.map(t => t.name));
            const appliedMigrations = (migrationsResult.migrations || []).filter(m => m.status === 'applied');
            const outFolder = config.get('outputFolder') || './migrations';
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                return;
            }
            const dir = path.resolve(workspaceRoot, outFolder);
            if (!fs.existsSync(dir)) {
                vscode.window.showInformationMessage('No local migrations folder found.');
                return;
            }
            const sqlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
            const localTableCreates = new Map();
            const localTableDrops = new Set();
            for (const file of sqlFiles) {
                const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
                const upper = sql.toUpperCase().replace(/\s+/g, ' ');
                for (const match of upper.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\S+)/g)) {
                    const table = match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, '');
                    if (!table.startsWith('_vpc_')) {
                        localTableCreates.set(table, file);
                    }
                }
                for (const match of upper.matchAll(/DROP TABLE (?:IF EXISTS )?(\S+)/g)) {
                    localTableDrops.add(match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, ''));
                }
            }
            const lines = [
                '-- VPC Sync: Schema Comparison Report',
                `-- Generated: ${new Date().toISOString()}`,
                `-- Database tables: ${dbTableNames.size}`,
                `-- Local CREATE TABLE statements: ${localTableCreates.size}`,
                '',
            ];
            const missingInDb = [];
            for (const [table, file] of localTableCreates) {
                if (!dbTableNames.has(table) && !localTableDrops.has(table)) {
                    missingInDb.push(`--   ${table}  (from ${file})`);
                }
            }
            if (missingInDb.length > 0) {
                lines.push(`-- TABLES IN LOCAL SQL BUT NOT IN DATABASE (${missingInDb.length}):`);
                lines.push(...missingInDb, '');
            }
            const missingInLocal = [];
            for (const table of dbTableNames) {
                if (!localTableCreates.has(table) && !table.startsWith('_vpc_')) {
                    missingInLocal.push(`--   ${table}`);
                }
            }
            if (missingInLocal.length > 0) {
                lines.push(`-- TABLES IN DATABASE BUT NOT IN LOCAL SQL (${missingInLocal.length}):`);
                lines.push(...missingInLocal, '');
            }
            const newFiles = scmProvider.getNewFiles();
            if (newFiles.length > 0) {
                lines.push(`-- UNPUSHED LOCAL FILES (${newFiles.length}):`);
                for (const f of newFiles) {
                    lines.push(`--   ${f.name}`);
                }
                lines.push('');
            }
            lines.push(`-- APPLIED MIGRATIONS: ${appliedMigrations.length}`);
            if (missingInDb.length === 0 && missingInLocal.length === 0 && newFiles.length === 0) {
                lines.push('', '-- Everything is in sync!');
            }
            const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'sql' });
            await vscode.window.showTextDocument(doc, { preview: true });
            if (missingInDb.length > 0) {
                vscode.window.showWarningMessage(`${missingInDb.length} table(s) in local SQL but not in DB.`);
            }
            else if (missingInLocal.length > 0) {
                vscode.window.showInformationMessage(`${missingInLocal.length} table(s) in DB but not in local SQL.`);
            }
            else {
                vscode.window.showInformationMessage('Schema is in sync!');
            }
            onComplete();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Detect failed: ${err.message}`);
        }
    });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map