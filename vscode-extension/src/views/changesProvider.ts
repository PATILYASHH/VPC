import * as vscode from 'vscode';
import { SyncApiClient, SchemaChange } from '../api/client';

export class ChangesProvider implements vscode.TreeDataProvider<ChangeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ChangeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private changes: SchemaChange[] = [];
  private client: SyncApiClient;

  constructor(client: SyncApiClient) {
    this.client = client;
  }

  refresh(): void {
    this.loadChanges();
  }

  private async loadChanges(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      this.changes = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    try {
      const result = await this.client.getChanges(url, key);
      this.changes = result.changes;
    } catch {
      this.changes = [];
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ChangeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ChangeItem[] {
    if (this.changes.length === 0) {
      return [new ChangeItem('No pending changes', '', '', vscode.TreeItemCollapsibleState.None, true)];
    }

    return this.changes.map(c => {
      const icon = this.getIconForType(c.event_type, c.object_type);
      const label = `${c.event_type} ${c.object_type || ''}`.trim();
      const desc = c.object_identity?.split('.').pop() || '';
      return new ChangeItem(label, desc, c.ddl_command, vscode.TreeItemCollapsibleState.None, false, icon);
    });
  }

  getPendingCount(): number {
    return this.changes.length;
  }

  private getIconForType(eventType: string, objectType: string): vscode.ThemeIcon {
    const type = (objectType || '').toLowerCase();
    if (type.includes('table')) { return new vscode.ThemeIcon('symbol-class'); }
    if (type.includes('index')) { return new vscode.ThemeIcon('symbol-key'); }
    if (type.includes('function') || type.includes('procedure')) { return new vscode.ThemeIcon('symbol-method'); }
    if (type.includes('view')) { return new vscode.ThemeIcon('symbol-interface'); }
    if (type.includes('trigger')) { return new vscode.ThemeIcon('zap'); }
    if (type.includes('sequence')) { return new vscode.ThemeIcon('symbol-number'); }

    const event = eventType.toUpperCase();
    if (event === 'DROP') { return new vscode.ThemeIcon('trash'); }
    if (event.includes('ALTER')) { return new vscode.ThemeIcon('edit'); }
    return new vscode.ThemeIcon('add');
  }
}

export class ChangeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    public readonly sql: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isEmpty = false,
    icon?: vscode.ThemeIcon
  ) {
    super(label, collapsibleState);
    this.description = description;

    if (isEmpty) {
      this.iconPath = new vscode.ThemeIcon('check');
      this.contextValue = 'empty';
    } else {
      this.iconPath = icon || new vscode.ThemeIcon('circle-filled');
      this.contextValue = 'change';
      this.tooltip = sql.substring(0, 500);
      this.command = {
        command: 'vpcSync.showSQL',
        title: 'Show SQL',
        arguments: [sql],
      };
    }
  }
}
