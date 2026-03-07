import * as vscode from 'vscode';
import type { SyncStatus } from './vpcScmProvider';

export class VpcFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private fileStatuses = new Map<string, SyncStatus>();

  updateStatuses(statuses: Map<string, SyncStatus>): void {
    this.fileStatuses = statuses;
    this._onDidChangeFileDecorations.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!uri.fsPath.endsWith('.sql')) { return undefined; }

    const status = this.fileStatuses.get(uri.fsPath);
    if (!status) { return undefined; }

    switch (status) {
      case 'new':
        return new vscode.FileDecoration(
          'N', 'New migration — not pushed',
          new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
        );
      case 'staged':
        return new vscode.FileDecoration(
          'S', 'Staged for push',
          new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        );
      case 'pushed':
        return new vscode.FileDecoration(
          'P', 'PR in review',
          new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
        );
      case 'applied':
        return new vscode.FileDecoration(
          'A', 'Applied to database',
          new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')
        );
      case 'failed':
        return new vscode.FileDecoration(
          'F', 'Migration failed',
          new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
        );
      default:
        return undefined;
    }
  }
}
