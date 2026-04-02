import * as vscode from 'vscode';
import { SyncApiClient, VPSHubIssue } from '../api/client';

export class IssuesProvider implements vscode.TreeDataProvider<IssueItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IssueItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private client: SyncApiClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: IssueItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: IssueItem): Promise<IssueItem[]> {
    if (element) { return []; }

    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('vpshubUrl');
    const token = config.get<string>('vpshubToken');
    const owner = config.get<string>('vpshubOwner');
    const repo = config.get<string>('vpshubRepo');

    if (!url || !token || !owner || !repo) { return []; }

    try {
      const { issues } = await this.client.vpshubListIssues(url, token, owner, repo);
      return issues.map(issue => new IssueItem(issue));
    } catch {
      return [];
    }
  }
}

class IssueItem extends vscode.TreeItem {
  constructor(public readonly issue: VPSHubIssue) {
    super(`#${issue.issue_number} ${issue.title}`, vscode.TreeItemCollapsibleState.None);

    const isOpen = issue.status === 'open';
    this.iconPath = new vscode.ThemeIcon(
      isOpen ? 'circle-filled' : 'pass-filled',
      new vscode.ThemeColor(isOpen ? 'charts.green' : 'charts.purple')
    );
    this.description = `${issue.author_username} · ${issue.status}`;
    this.tooltip = new vscode.MarkdownString(
      `**#${issue.issue_number}: ${issue.title}**\n\n` +
      `Status: ${issue.status}\n\n` +
      `Author: ${issue.author_username}\n\n` +
      `Created: ${issue.created_at}\n\n` +
      (issue.body ? `---\n\n${issue.body.substring(0, 200)}` : '')
    );

    this.command = {
      command: 'vpcSync.viewIssue',
      title: 'View Issue',
      arguments: [issue.issue_number],
    };

    this.contextValue = isOpen ? 'openIssue' : 'closedIssue';
  }
}
