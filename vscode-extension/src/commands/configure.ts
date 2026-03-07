import * as vscode from 'vscode';

export async function configureCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcPull');

  const url = await vscode.window.showInputBox({
    prompt: 'BanaDB Project API URL',
    placeHolder: 'https://your-server.com/api/bana/v1/your-project',
    value: config.get<string>('serverUrl') || '',
    validateInput: (value) => {
      if (!value.includes('/api/bana/v1/')) {
        return 'URL must include /api/bana/v1/<project-slug>';
      }
      return null;
    },
  });

  if (!url) {
    return;
  }

  const key = await vscode.window.showInputBox({
    prompt: 'Pull API Key',
    placeHolder: 'bana_pull_...',
    value: config.get<string>('apiKey') || '',
    password: true,
  });

  if (!key) {
    return;
  }

  await config.update('serverUrl', url, vscode.ConfigurationTarget.Workspace);
  await config.update('apiKey', key, vscode.ConfigurationTarget.Workspace);

  vscode.window.showInformationMessage('VPC Pull configured successfully. Status bar will update shortly.');
}
