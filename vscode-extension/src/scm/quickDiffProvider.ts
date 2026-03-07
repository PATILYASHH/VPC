import * as vscode from 'vscode';

/**
 * Provides the "original" resource URI for Quick Diff gutter decorations.
 * Maps local .sql files to their vpc-original:// counterpart.
 */
export class VpcQuickDiffProvider implements vscode.QuickDiffProvider {
  provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
    if (!uri.fsPath.endsWith('.sql')) { return undefined; }
    return vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
  }
}

/**
 * Serves content for vpc-original:// URIs — returns the SQL that was
 * applied to the database, enabling diff comparison with local edits.
 */
export class VpcOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private originalContent = new Map<string, string>();

  updateOriginals(content: Map<string, string>): void {
    this.originalContent = content;
    for (const fsPath of content.keys()) {
      this._onDidChange.fire(vscode.Uri.parse(`vpc-original://${encodeURIComponent(fsPath)}`));
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const fsPath = decodeURIComponent(uri.authority + uri.path).replace(/^\/\//, '');
    // Try direct lookup and then path-only lookup
    return this.originalContent.get(fsPath)
      || this.originalContent.get(decodeURIComponent(uri.path.slice(1)))
      || '';
  }
}
