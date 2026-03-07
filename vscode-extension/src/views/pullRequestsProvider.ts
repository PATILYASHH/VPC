import * as vscode from 'vscode';
import { SyncApiClient } from '../api/client';

export class PullRequestsProvider implements vscode.TreeDataProvider<PRItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PRItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private prs: any[] = [];
  private client: SyncApiClient;

  constructor(client: SyncApiClient) {
    this.client = client;
  }

  refresh(): void {
    this.loadPRs();
  }

  private async loadPRs(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      this.prs = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    try {
      const result = await this.client.getPullRequests(url, key);
      this.prs = result.pull_requests || [];
    } catch {
      this.prs = [];
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: PRItem): vscode.TreeItem {
    return element;
  }

  getChildren(): PRItem[] {
    if (this.prs.length === 0) {
      return [new PRItem('No pull requests', '', vscode.TreeItemCollapsibleState.None, true)];
    }

    return this.prs.map(pr => {
      const icon = this.getStatusIcon(pr.status);
      const desc = `${pr.status} · ${pr.submitted_by}`;
      return new PRItem(
        `#${pr.pr_number} ${pr.title}`,
        desc,
        vscode.TreeItemCollapsibleState.None,
        false,
        icon,
        pr
      );
    });
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'open': return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('testing.iconPassed'));
      case 'merged': return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
      case 'closed': return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('testing.iconFailed'));
      case 'conflict': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      case 'testing': return new vscode.ThemeIcon('loading~spin');
      default: return new vscode.ThemeIcon('git-pull-request');
    }
  }
}

export class PRItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isEmpty = false,
    icon?: vscode.ThemeIcon,
    public readonly pr?: any,
  ) {
    super(label, collapsibleState);
    this.description = description;

    if (isEmpty) {
      this.iconPath = new vscode.ThemeIcon('git-pull-request');
      this.contextValue = 'empty';
    } else {
      this.iconPath = icon || new vscode.ThemeIcon('git-pull-request');
      this.contextValue = 'pullRequest';
      if (pr) {
        this.tooltip = `#${pr.pr_number} ${pr.title}\nStatus: ${pr.status}\nBy: ${pr.submitted_by}\n${new Date(pr.created_at).toLocaleString()}`;
        this.command = {
          command: 'vpcSync.showSQL',
          title: 'Show SQL',
          arguments: [pr.sql_content],
        };
      }
    }
  }
}
