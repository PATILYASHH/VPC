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
const client_1 = require("./api/client");
const changesProvider_1 = require("./views/changesProvider");
const migrationsProvider_1 = require("./views/migrationsProvider");
const historyProvider_1 = require("./views/historyProvider");
const configViewProvider_1 = require("./views/configViewProvider");
const pull_1 = require("./commands/pull");
const push_1 = require("./commands/push");
let statusBar;
function activate(context) {
    const client = new client_1.SyncApiClient();
    // Tree view providers
    const changesProvider = new changesProvider_1.ChangesProvider(client);
    const migrationsProvider = new migrationsProvider_1.MigrationsProvider();
    const historyProvider = new historyProvider_1.HistoryProvider(client);
    function refreshAll() {
        changesProvider.refresh();
        migrationsProvider.refresh();
        historyProvider.refresh();
        configViewProvider.refresh();
        refreshStatusBar(client);
    }
    // Config webview provider (sidebar UI for entering URL + API key)
    const configViewProvider = new configViewProvider_1.ConfigViewProvider(client, () => refreshAll());
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(configViewProvider_1.ConfigViewProvider.viewType, configViewProvider));
    // Register tree views
    context.subscriptions.push(vscode.window.registerTreeDataProvider('vpcSync.changes', changesProvider), vscode.window.registerTreeDataProvider('vpcSync.migrations', migrationsProvider), vscode.window.registerTreeDataProvider('vpcSync.history', historyProvider));
    // Status bar
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'vpcSync.pull';
    statusBar.tooltip = 'VPC Sync: Click to pull schema changes';
    context.subscriptions.push(statusBar);
    // Commands
    context.subscriptions.push(vscode.commands.registerCommand('vpcSync.configure', () => {
        // Focus the config webview in the sidebar
        vscode.commands.executeCommand('vpcSync.config.focus');
    }), vscode.commands.registerCommand('vpcSync.pull', () => (0, pull_1.pullCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.pullAll', () => (0, pull_1.pullCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.push', () => (0, push_1.pushCommand)(client, () => refreshAll())), vscode.commands.registerCommand('vpcSync.pushFile', (item) => (0, push_1.pushCommand)(client, () => refreshAll(), item?.filePath)), vscode.commands.registerCommand('vpcSync.status', () => showStatus(client)), vscode.commands.registerCommand('vpcSync.refresh', () => refreshAll()), vscode.commands.registerCommand('vpcSync.selectFolder', () => selectOutputFolder()), vscode.commands.registerCommand('vpcSync.showSQL', (sql) => showSQL(sql)));
    // Auto-refresh
    const intervalSec = vscode.workspace.getConfiguration('vpcSync').get('autoRefreshInterval') || 30;
    if (intervalSec > 0) {
        const interval = setInterval(() => refreshAll(), intervalSec * 1000);
        context.subscriptions.push({ dispose: () => clearInterval(interval) });
    }
    // Initial refresh
    refreshAll();
}
async function refreshStatusBar(client) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        statusBar.hide();
        return;
    }
    try {
        const status = await client.getStatus(url, key);
        const pending = status.pending_changes || 0;
        if (pending > 0) {
            statusBar.text = `$(cloud-download) VPC Sync: ${pending} pending`;
            statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
        else {
            statusBar.text = `$(check) VPC Sync: up to date`;
            statusBar.backgroundColor = undefined;
        }
        statusBar.show();
    }
    catch {
        statusBar.text = `$(warning) VPC Sync: offline`;
        statusBar.backgroundColor = undefined;
        statusBar.show();
    }
}
async function showStatus(client) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        vscode.window.showWarningMessage('VPC Sync not configured. Run "VPC Sync: Configure Connection" first.');
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
    if (uri && uri[0]) {
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
function deactivate() { }
//# sourceMappingURL=extension.js.map