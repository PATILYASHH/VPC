import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SyncApiClient } from '../api/client';

export async function pushCommand(client: SyncApiClient, onComplete?: () => void, filePath?: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    const action = await vscode.window.showErrorMessage(
      'VPC Sync not configured.',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      vscode.commands.executeCommand('vpcSync.configure');
    }
    return;
  }

  // If no file path provided, let user pick a .sql file
  if (!filePath) {
    const outFolder = config.get<string>('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder open.');
      return;
    }

    const dir = path.resolve(workspaceRoot, outFolder);
    if (!fs.existsSync(dir)) {
      vscode.window.showWarningMessage('No migrations folder found.');
      return;
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    if (files.length === 0) {
      vscode.window.showWarningMessage('No SQL migration files found.');
      return;
    }

    const selected = await vscode.window.showQuickPick(files, {
      placeHolder: 'Select a migration file to push',
    });

    if (!selected) { return; }
    filePath = path.join(dir, selected);
  }

  // Confirm push
  const fileName = path.basename(filePath);
  const confirm = await vscode.window.showWarningMessage(
    `Push "${fileName}" to remote database? This will execute the SQL.`,
    { modal: true },
    'Push'
  );

  if (confirm !== 'Push') { return; }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'VPC Sync',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Pushing ${fileName}...` });

      try {
        const sql = fs.readFileSync(filePath!, 'utf-8');
        const name = path.basename(filePath!, '.sql');

        const result = await client.push(url, key, sql, name);

        vscode.window.showInformationMessage(
          `Pushed migration v${result.version} — ${result.status}`
        );

        onComplete?.();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Push failed: ${err.message}`);
      }
    }
  );
}
