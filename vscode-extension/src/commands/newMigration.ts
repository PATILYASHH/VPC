import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function newMigrationCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const outFolder = config.get<string>('outputFolder') || './migrations';
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Migration name',
    placeHolder: 'add_users_table',
    validateInput: (value) => {
      if (!value || !/^[a-z0-9_]+$/i.test(value)) {
        return 'Use letters, numbers, and underscores only';
      }
      return null;
    },
  });

  if (!name) { return; }

  const dir = path.resolve(workspaceRoot, outFolder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name.toLowerCase()}.sql`;
  const filePath = path.join(dir, filename);

  const template = [
    `-- Migration: ${name}`,
    `-- Created: ${new Date().toISOString()}`,
    '',
    '-- Write your SQL migration here:',
    '',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, template);
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(`Created migration: ${filename}`);
}
