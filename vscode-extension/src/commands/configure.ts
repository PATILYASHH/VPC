import * as vscode from 'vscode';

export async function configureCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');

  const url = await vscode.window.showInputBox({
    prompt: 'BanaDB Project API URL',
    placeHolder: 'http://your-server:8001/api/bana/v1/your-project',
    value: config.get<string>('serverUrl') || '',
    validateInput: (value) => {
      if (!value.includes('/api/bana/v1/')) {
        return 'URL must include /api/bana/v1/<project-slug>';
      }
      return null;
    },
  });

  if (!url) { return; }

  const key = await vscode.window.showInputBox({
    prompt: 'Pull API Key',
    placeHolder: 'bana_pull_...',
    value: config.get<string>('apiKey') || '',
    password: true,
  });

  if (!key) { return; }

  await config.update('serverUrl', url, vscode.ConfigurationTarget.Workspace);
  await config.update('apiKey', key, vscode.ConfigurationTarget.Workspace);

  vscode.window.showInformationMessage('VPC Sync configured successfully. Sidebar will refresh shortly.');

  // Trigger refresh
  vscode.commands.executeCommand('vpcSync.refresh');
}
