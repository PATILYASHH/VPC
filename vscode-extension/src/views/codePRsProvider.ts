import * as vscode from 'vscode';
import { SyncApiClient, VPSHubPR } from '../api/client';

export class CodePRsProvider implements vscode.TreeDataProvider<CodePRItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CodePRItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private client: SyncApiClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CodePRItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: CodePRItem): Promise<CodePRItem[]> {
    if (element) { return []; }

    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl');
    const token = config.get<string>('vpshubToken');
    const owner = config.get<string>('vpshubOwner');
    const repo = config.get<string>('vpshubRepo');

    if (!url || !token || !owner || !repo) { return []; }

    try {
      const { pullRequests } = await this.client.vpshubListPRs(url, token, owner, repo);
      return (pullRequests || []).map(pr => new CodePRItem(pr));
    } catch {
      return [];
    }
  }
}

class CodePRItem extends vscode.TreeItem {
  constructor(public readonly pr: VPSHubPR) {
    super(`#${pr.pr_number} ${pr.title}`, vscode.TreeItemCollapsibleState.None);

    const iconMap: Record<string, { icon: string; color: string }> = {
      open: { icon: 'git-pull-request', color: 'charts.green' },
      merged: { icon: 'git-merge', color: 'charts.purple' },
      closed: { icon: 'git-pull-request-closed', color: 'charts.red' },
    };
    const style = iconMap[pr.status] || iconMap.open;

    this.iconPath = new vscode.ThemeIcon(style.icon, new vscode.ThemeColor(style.color));
    this.description = `${pr.source_branch} → ${pr.target_branch}`;
    this.tooltip = new vscode.MarkdownString(
      `**PR #${pr.pr_number}: ${pr.title}**\n\n` +
      `${pr.source_branch} → ${pr.target_branch}\n\n` +
      `Status: ${pr.status} · Author: ${pr.author_username}\n\n` +
      `Created: ${pr.created_at}` +
      (pr.merged_at ? `\n\nMerged: ${pr.merged_at}` : '')
    );

    this.command = {
      command: 'vpcSync.viewCodePRDiff',
      title: 'View Diff',
      arguments: [pr.pr_number],
    };

    this.contextValue = pr.status === 'open' ? 'openPR' : pr.status === 'merged' ? 'mergedPR' : 'closedPR';
  }
}
