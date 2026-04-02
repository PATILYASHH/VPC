import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';

export async function selectRepoCommand(client: SyncApiClient, onComplete: () => void): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('vpshubUrl');
  const token = config.get<string>('vpshubToken');

  if (!url || !token) {
    vscode.window.showWarningMessage('Set vpshubUrl and vpshubToken first.');
    return;
  }

  try {
    const { repos } = await client.vpshubGetRepos(url, token);
    if (repos.length === 0) {
      vscode.window.showInformationMessage('No repositories found.');
      return;
    }

    const items = repos.map(r => ({
      label: `${r.owner_username}/${r.name}`,
      description: `${r.visibility} · ${r.description || ''}`,
      detail: [
        r.linked_project_id ? '$(database) DB' : '',
        r.linked_hosting_id ? '$(globe) Hosting' : '',
      ].filter(Boolean).join(' · ') || undefined,
      owner: r.owner_username,
      slug: r.slug,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a repository to connect',
      matchOnDescription: true,
    });

    if (!selected) { return; }

    await config.update('vpshubOwner', selected.owner, vscode.ConfigurationTarget.Workspace);
    await config.update('vpshubRepo', selected.slug, vscode.ConfigurationTarget.Workspace);

    vscode.window.showInformationMessage(`Connected to ${selected.label}`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to list repos: ${err.message}`);
  }
}

export async function switchBranchCommand(client: SyncApiClient, onComplete: () => void): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('vpshubUrl') || '';
  const token = config.get<string>('vpshubToken') || '';
  const owner = config.get<string>('vpshubOwner') || '';
  const repo = config.get<string>('vpshubRepo') || '';

  if (!url || !token || !owner || !repo) {
    vscode.window.showWarningMessage('Select a repository first.');
    return;
  }

  try {
    const { branches } = await client.vpshubGetBranches(url, token, owner, repo);
    if (branches.length === 0) {
      vscode.window.showInformationMessage('No branches found.');
      return;
    }

    const currentBranch = config.get<string>('vpshubBranch') || 'main';
    const items = branches.map(b => ({
      label: b,
      description: b === currentBranch ? '(current)' : '',
    }));

    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Switch branch' });
    if (!selected) { return; }

    await config.update('vpshubBranch', selected.label, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Switched to branch: ${selected.label}`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to list branches: ${err.message}`);
  }
}

export async function cloneRepoCommand(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('vpshubUrl');
  const token = config.get<string>('vpshubToken');

  if (!url || !token) {
    vscode.window.showWarningMessage('Set vpshubUrl and vpshubToken first.');
    return;
  }

  try {
    const { repos } = await client.vpshubGetRepos(url, token);
    if (repos.length === 0) {
      vscode.window.showInformationMessage('No repositories found.');
      return;
    }

    const items = repos.map(r => ({
      label: `${r.owner_username}/${r.name}`,
      description: r.visibility,
      cloneUrl: `${url}/git/${r.owner_username}/${r.slug}.git`,
    }));

    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select repo to clone' });
    if (!selected) { return; }

    // Use VS Code's built-in git clone
    await vscode.commands.executeCommand('git.clone', selected.cloneUrl);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to list repos: ${err.message}`);
  }
}
