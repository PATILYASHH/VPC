import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class MigrationsProvider implements vscode.TreeDataProvider<MigrationFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MigrationFileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: string[] = [];

  refresh(): void {
    this.loadFiles();
  }

  private loadFiles(): void {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const outFolder = config.get<string>('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      this.files = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    const dir = path.resolve(workspaceRoot, outFolder);
    try {
      if (fs.existsSync(dir)) {
        this.files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.sql'))
          .sort()
          .reverse(); // newest first
      } else {
        this.files = [];
      }
    } catch {
      this.files = [];
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MigrationFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MigrationFileItem[] {
    if (this.files.length === 0) {
      return [new MigrationFileItem('No local migrations', '', vscode.TreeItemCollapsibleState.None, true)];
    }

    const config = vscode.workspace.getConfiguration('vpcSync');
    const outFolder = config.get<string>('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const dir = path.resolve(workspaceRoot, outFolder);

    return this.files.map(f => {
      const filePath = path.join(dir, f);
      const stat = fs.statSync(filePath);
      const sizeKb = (stat.size / 1024).toFixed(1);
      return new MigrationFileItem(f, `${sizeKb} KB`, vscode.TreeItemCollapsibleState.None, false, filePath);
    });
  }
}

export class MigrationFileItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    isEmpty = false,
    public readonly filePath?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;

    if (isEmpty) {
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'empty';
    } else {
      this.iconPath = new vscode.ThemeIcon('file-code');
      this.contextValue = 'pendingMigration';
      this.tooltip = filePath;
      this.command = {
        command: 'vscode.open',
        title: 'Open Migration',
        arguments: [vscode.Uri.file(filePath!)],
      };
    }
  }
}
