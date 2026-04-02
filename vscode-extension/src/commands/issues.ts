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

export async function createIssueCommand(client: SyncApiClient, onComplete: () => void): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) {
    vscode.window.showWarningMessage('VPSHub not configured. Set vpshubUrl, vpshubToken, vpshubOwner, and vpshubRepo.');
    return;
  }

  const title = await vscode.window.showInputBox({ prompt: 'Issue title', placeHolder: 'Describe the issue...' });
  if (!title) { return; }

  const body = await vscode.window.showInputBox({ prompt: 'Issue description (optional)', placeHolder: 'Additional details...' });

  try {
    const result = await client.vpshubCreateIssue(url, token, owner, repo, title, body || '');
    vscode.window.showInformationMessage(`Issue #${result.issue.issue_number} created: ${title}`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
  }
}

export async function closeIssueCommand(client: SyncApiClient, onComplete: () => void, issueNumber?: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  if (!issueNumber) {
    const input = await vscode.window.showInputBox({ prompt: 'Issue number to close' });
    if (!input) { return; }
    issueNumber = parseInt(input, 10);
  }

  try {
    await client.vpshubCloseIssue(url, token, owner, repo, issueNumber);
    vscode.window.showInformationMessage(`Issue #${issueNumber} closed.`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to close issue: ${err.message}`);
  }
}

export async function commentOnIssueCommand(client: SyncApiClient, onComplete: () => void, issueNumber?: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  if (!issueNumber) {
    const input = await vscode.window.showInputBox({ prompt: 'Issue number' });
    if (!input) { return; }
    issueNumber = parseInt(input, 10);
  }

  const body = await vscode.window.showInputBox({ prompt: 'Your comment' });
  if (!body) { return; }

  try {
    await client.vpshubCommentOnIssue(url, token, owner, repo, issueNumber, body);
    vscode.window.showInformationMessage(`Comment added to issue #${issueNumber}.`);
    onComplete();
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to comment: ${err.message}`);
  }
}

export async function viewIssueCommand(client: SyncApiClient, issueNumber: number): Promise<void> {
  const { url, token, owner, repo } = getVpshubConfig();
  if (!url || !token || !owner || !repo) { return; }

  try {
    const data = await client.vpshubGetIssue(url, token, owner, repo, issueNumber);
    const issue = data.issue;
    const comments = data.comments || [];

    const lines = [
      `# Issue #${issue.issue_number}: ${issue.title}`,
      `Status: ${issue.status} | Author: ${issue.author_username} | Created: ${issue.created_at}`,
      '',
      issue.body || '(No description)',
      '',
      `--- Comments (${comments.length}) ---`,
      '',
    ];

    for (const c of comments) {
      lines.push(`[${c.author_username}] ${c.created_at}`);
      lines.push(c.body);
      lines.push('');
    }

    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to load issue: ${err.message}`);
  }
}
