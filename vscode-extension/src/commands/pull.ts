import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SyncApiClient } from '../api/client';

export async function pullCommand(client: SyncApiClient, onComplete?: () => void): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');
  const outFolder = config.get<string>('outputFolder') || './migrations';

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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'VPC Sync',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Pulling schema changes...' });

      try {
        const result = await client.pull(url, key);

        if (!result.migration) {
          vscode.window.showInformationMessage(result.message || 'No pending changes to pull.');
          onComplete?.();
          return;
        }

        progress.report({ message: `Saving migration v${result.migration.version}...` });

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const outDir = path.resolve(workspaceRoot, outFolder);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        const filename = `${String(result.migration.version).padStart(4, '0')}_${result.migration.name || 'migration'}.sql`;
        const filePath = path.join(outDir, filename);
        fs.writeFileSync(filePath, result.migration.sql_up);

        // Open the migration file
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(
          `Pulled ${result.change_count} changes → ${filename}`
        );

        onComplete?.();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
      }
    }
  );
}
