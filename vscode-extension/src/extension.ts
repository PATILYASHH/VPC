import * as vscode from 'vscode';
import { SyncApiClient } from './api/client';
import { ChangesProvider } from './views/changesProvider';
import { MigrationsProvider } from './views/migrationsProvider';
import { HistoryProvider } from './views/historyProvider';
import { ConfigViewProvider } from './views/configViewProvider';
import { pullCommand } from './commands/pull';
import { pushCommand } from './commands/push';

let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const client = new SyncApiClient();

  // Tree view providers
  const changesProvider = new ChangesProvider(client);
  const migrationsProvider = new MigrationsProvider();
  const historyProvider = new HistoryProvider(client);

  function refreshAll() {
    changesProvider.refresh();
    migrationsProvider.refresh();
    historyProvider.refresh();
    configViewProvider.refresh();
    refreshStatusBar(client);
  }

  // Config webview provider (sidebar UI for entering URL + API key)
  const configViewProvider = new ConfigViewProvider(client, () => refreshAll());
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ConfigViewProvider.viewType, configViewProvider),
  );

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('vpcSync.changes', changesProvider),
    vscode.window.registerTreeDataProvider('vpcSync.migrations', migrationsProvider),
    vscode.window.registerTreeDataProvider('vpcSync.history', historyProvider),
  );

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'vpcSync.pull';
  statusBar.tooltip = 'VPC Sync: Click to pull schema changes';
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('vpcSync.configure', () => {
      // Focus the config webview in the sidebar
      vscode.commands.executeCommand('vpcSync.config.focus');
    }),
    vscode.commands.registerCommand('vpcSync.pull', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pullAll', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.push', () => pushCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pushFile', (item: any) => pushCommand(client, () => refreshAll(), item?.filePath)),
    vscode.commands.registerCommand('vpcSync.status', () => showStatus(client)),
    vscode.commands.registerCommand('vpcSync.refresh', () => refreshAll()),
    vscode.commands.registerCommand('vpcSync.selectFolder', () => selectOutputFolder()),
    vscode.commands.registerCommand('vpcSync.showSQL', (sql: string) => showSQL(sql)),
  );

  // Auto-refresh
  const intervalSec = vscode.workspace.getConfiguration('vpcSync').get<number>('autoRefreshInterval') || 30;
  if (intervalSec > 0) {
    const interval = setInterval(() => refreshAll(), intervalSec * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }

  // Initial refresh
  refreshAll();
}

async function refreshStatusBar(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

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
    } else {
      statusBar.text = `$(check) VPC Sync: up to date`;
      statusBar.backgroundColor = undefined;
    }
    statusBar.show();
  } catch {
    statusBar.text = `$(warning) VPC Sync: offline`;
    statusBar.backgroundColor = undefined;
    statusBar.show();
  }
}

async function showStatus(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    vscode.window.showWarningMessage('VPC Sync not configured. Run "VPC Sync: Configure Connection" first.');
    return;
  }

  try {
    const status = await client.getStatus(url, key);
    vscode.window.showInformationMessage(
      `Project: ${status.project.name} | Tracking: ${status.tracking_enabled ? 'ON' : 'OFF'} | Pending: ${status.pending_changes} | Migrations: ${status.total_migrations}`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Status failed: ${err.message}`);
  }
}

async function selectOutputFolder(): Promise<void> {
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

async function showSQL(sql: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: sql, language: 'sql' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export function deactivate() {}
