import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PullApiClient } from '../api/client';

export async function pullCommand(client: PullApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcPull');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');
  const outFolder = config.get<string>('outputFolder') || './migrations';

  if (!url || !key) {
    const action = await vscode.window.showErrorMessage(
      'VPC Pull not configured.',
      'Configure Now'
    );
    if (action === 'Configure Now') {
      vscode.commands.executeCommand('vpcPull.configure');
    }
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'VPC Pull',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Fetching schema changes...' });

      try {
        const result = await client.fetchMigration(url, key);

        if (!result.migration) {
          vscode.window.showInformationMessage('No new schema changes since last pull.');
          return;
        }

        progress.report({ message: `Writing ${result.change_count} changes...` });

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        const outDir = path.resolve(workspaceRoot, outFolder);
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }

        const filePath = path.join(outDir, result.migration.filename);
        fs.writeFileSync(filePath, result.migration.content);

        // Acknowledge the pull
        await client.ackPull(url, key, result.latest_id!);

        // Open the migration file
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc);

        vscode.window.showInformationMessage(
          `Pulled ${result.change_count} changes → ${result.migration.filename}`
        );

        if (result.has_more) {
          const again = await vscode.window.showWarningMessage(
            'More changes available.',
            'Pull Again'
          );
          if (again === 'Pull Again') {
            pullCommand(client);
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
      }
    }
  );
}
