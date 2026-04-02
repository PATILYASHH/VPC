import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';

function getVpshubConfig() {
  const config = vscode.workspace.getConfiguration('vpcSync');
  return {
    url: config.get<string>('vpshubUrl') || '',
    token: config.get<string>('vpshubToken') || '',
    owner: config.get<string>('vpshubOwner') || '',
    repo: config.get<string>('vpshubRepo') || '',
  };
}

export async function deployCommand(client: SyncApiClient, onComplete: () => void): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) {
    vscode.window.showWarningMessage('VPSHub not configured.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Deploying...', cancellable: false },
    async () => {
      try {
        const result = await client.vpshubDeployHosting(url, token, owner, repo);
        vscode.window.showInformationMessage(result.message || 'Deploy successful!');
        onComplete();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
      }
    }
  );
}

export async function hostingControlCommand(client: SyncApiClient, onComplete: () => void, action?: string): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  if (!action) {
    action = await vscode.window.showQuickPick(['start', 'stop', 'restart'], { placeHolder: 'Select action' }) || undefined;
    if (!action) { return; }
  }

  try {
    const result = await client.vpshubHostingControl(url, token, owner, repo, action);
    vscode.window.showInformationMessage(result.message || `${action} successful!`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
  }
}

export async function viewHostingLogsCommand(client: SyncApiClient): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  try {
    const data = await client.vpshubGetHostingLogs(url, token, owner, repo);
    const doc = await vscode.workspace.openTextDocument({ content: data.logs || 'No logs available', language: 'log' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to fetch logs: ${err.message}`);
  }
}

export async function hostingStatusCommand(client: SyncApiClient): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) {
    vscode.window.showWarningMessage('VPSHub not configured.');
    return;
  }

  try {
    const data = await client.vpshubGetHostingStatus(url, token, owner, repo);
    if (!data.hosting) {
      vscode.window.showInformationMessage('No hosting linked to this repository.');
      return;
    }
    const h = data.hosting;
    const s = data.status;
    vscode.window.showInformationMessage(
      `Hosting: ${h.name} | Type: ${h.type} | Status: ${s?.status || 'unknown'}${s?.uptime ? ` | Uptime: ${s.uptime}` : ''}${s?.memory ? ` | RAM: ${s.memory}` : ''}`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to get status: ${err.message}`);
  }
}
