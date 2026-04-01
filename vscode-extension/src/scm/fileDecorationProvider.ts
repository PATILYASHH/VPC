import * as vscode from 'vscode';

export class VpcFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  onDidChangeFileDecorations = this._onDidChange.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Decorations are handled by the SCM resource state decorations
    return undefined;
  }
}
