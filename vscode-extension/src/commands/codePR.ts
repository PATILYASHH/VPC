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

export async function createCodePRCommand(client: SyncApiClient, onComplete: () => void): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) {
    vscode.window.showWarningMessage('VPSHub not configured.');
    return;
  }

  // Get branches
  let branches: string[] = [];
  try {
    const result = await client.vpshubGetBranches(url, token, owner, repo);
    branches = result.branches || [];
  } catch {
    vscode.window.showErrorMessage('Failed to fetch branches.');
    return;
  }

  if (branches.length < 2) {
    vscode.window.showWarningMessage('Need at least 2 branches to create a PR.');
    return;
  }

  const sourceBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Source branch (your changes)' });
  if (!sourceBranch) { return; }

  const targetBranch = await vscode.window.showQuickPick(
    branches.filter(b => b !== sourceBranch),
    { placeHolder: 'Target branch (merge into)' }
  );
  if (!targetBranch) { return; }

  const title = await vscode.window.showInputBox({ prompt: 'PR title', placeHolder: 'What does this PR do?' });
  if (!title) { return; }

  const description = await vscode.window.showInputBox({ prompt: 'PR description (optional)' });

  try {
    const result = await client.vpshubCreatePR(url, token, owner, repo, title, description || '', sourceBranch, targetBranch);
    vscode.window.showInformationMessage(`PR #${result.pr.pr_number} created: ${sourceBranch} → ${targetBranch}`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to create PR: ${err.message}`);
  }
}

export async function mergePRCommand(client: SyncApiClient, onComplete: () => void, prNumber?: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  if (!prNumber) {
    const input = await vscode.window.showInputBox({ prompt: 'PR number to merge' });
    if (!input) { return; }
    prNumber = parseInt(input, 10);
  }

  const confirm = await vscode.window.showWarningMessage(
    `Merge PR #${prNumber}?`, { modal: true }, 'Merge'
  );
  if (confirm !== 'Merge') { return; }

  try {
    await client.vpshubMergePR(url, token, owner, repo, prNumber);
    vscode.window.showInformationMessage(`PR #${prNumber} merged successfully!`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
  }
}

export async function viewPRDiffCommand(client: SyncApiClient, prNumber: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  try {
    const data = await client.vpshubGetPRDiff(url, token, owner, repo, prNumber);
    const doc = await vscode.workspace.openTextDocument({ content: data.diff || 'No changes', language: 'diff' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to load diff: ${err.message}`);
  }
}

export async function commentOnPRCommand(client: SyncApiClient, onComplete: () => void, prNumber?: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  if (!prNumber) {
    const input = await vscode.window.showInputBox({ prompt: 'PR number' });
    if (!input) { return; }
    prNumber = parseInt(input, 10);
  }

  const body = await vscode.window.showInputBox({ prompt: 'Your comment' });
  if (!body) { return; }

  try {
    await client.vpshubCommentOnPR(url, token, owner, repo, prNumber, body);
    vscode.window.showInformationMessage(`Comment added to PR #${prNumber}.`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to comment: ${err.message}`);
  }
}
