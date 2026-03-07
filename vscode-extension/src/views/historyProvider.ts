import * as vscode from 'vscode';
import { SyncApiClient, MigrationRecord } from '../api/client';

export class HistoryProvider implements vscode.TreeDataProvider<HistoryItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<HistoryItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private migrations: MigrationRecord[] = [];
  private client: SyncApiClient;

  constructor(client: SyncApiClient) {
    this.client = client;
  }

  refresh(): void {
    this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      this.migrations = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    try {
      const result = await this.client.getMigrations(url, key);
      this.migrations = result.migrations;
    } catch {
      this.migrations = [];
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: HistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(): HistoryItem[] {
    if (this.migrations.length === 0) {
      return [new HistoryItem('No migration history', '', vscode.TreeItemCollapsibleState.None, true)];
    }

    return this.migrations.map(m => {
      const icon = this.getStatusIcon(m.status);
      const date = m.applied_at || m.created_at;
      const dateStr = new Date(date).toLocaleDateString();
      const desc = `${m.status} - ${dateStr}`;
      return new HistoryItem(`v${m.version} ${m.name || ''}`.trim(), desc, vscode.TreeItemCollapsibleState.None, false, icon, m);
    });
  }

  private getStatusIcon(status: string): vscode.ThemeIcon {
    switch (status) {
      case 'applied': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
      case 'pending': return new vscode.ThemeIcon('circle-outline');
      case 'rolled_back': return new vscode.ThemeIcon('debug-reverse-continue', new vscode.ThemeColor('testing.iconSkipped'));
      case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      default: return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class HistoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isEmpty = false,
    icon?: vscode.ThemeIcon,
    public readonly migration?: MigrationRecord,
  ) {
    super(label, collapsibleState);
    this.description = description;

    if (isEmpty) {
      this.iconPath = new vscode.ThemeIcon('history');
      this.contextValue = 'empty';
    } else {
      this.iconPath = icon || new vscode.ThemeIcon('circle-outline');
      this.contextValue = 'historyItem';
      if (migration) {
        this.tooltip = `Status: ${migration.status}\nSource: ${migration.source}\nApplied by: ${migration.applied_by || '-'}`;
        this.command = {
          command: 'vpcSync.showSQL',
          title: 'Show SQL',
          arguments: [migration.sql_up],
        };
      }
    }
  }
}
