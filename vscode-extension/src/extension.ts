import * as vscode from 'vscode';
import { pullCommand } from './commands/pull';
import { configureCommand } from './commands/configure';
import { StatusBarManager } from './views/statusBar';
import { PullApiClient } from './api/client';

let statusBar: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  const client = new PullApiClient();
  statusBar = new StatusBarManager(client);

  context.subscriptions.push(
    vscode.commands.registerCommand('vpcPull.configure', () => configureCommand()),
    vscode.commands.registerCommand('vpcPull.pull', () => pullCommand(client)),
    vscode.commands.registerCommand('vpcPull.status', () => statusBar.showStatus()),
    vscode.commands.registerCommand('vpcPull.selectFolder', () => selectOutputFolder()),
    statusBar.getStatusBarItem()
  );

  // Auto-refresh status bar
  const intervalSec = vscode.workspace.getConfiguration('vpcPull').get<number>('autoRefreshInterval') || 60;
  if (intervalSec > 0) {
    const interval = setInterval(() => statusBar.refresh(), intervalSec * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }

  // Initial refresh
  statusBar.refresh();
}

async function selectOutputFolder() {
  const uri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Migration Output Folder',
  });

  if (uri && uri[0]) {
    const config = vscode.workspace.getConfiguration('vpcPull');
    const relativePath = vscode.workspace.asRelativePath(uri[0]);
    await config.update('outputFolder', relativePath, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Output folder set to: ${relativePath}`);
  }
}

export function deactivate() {}
