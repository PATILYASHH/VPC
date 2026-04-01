/**
 * Commit History Tree View
 */

import * as vscode from 'vscode';
import * as objects from '../vcs/objects';
import * as refs from '../vcs/refs';

export class CommitHistoryProvider implements vscode.TreeDataProvider<CommitItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: CommitItem): vscode.TreeItem { return element; }

  getChildren(): CommitItem[] {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root || !objects.hasVpcRepo(root)) { return []; }

    const headHash = refs.resolveRef(root, 'HEAD');
    if (!headHash) { return []; }

    const commits: CommitItem[] = [];
    const visited = new Set<string>();
    const queue = [headHash];
    const limit = 50;

    while (queue.length > 0 && commits.length < limit) {
      const hash = queue.shift()!;
      if (!hash || visited.has(hash)) { continue; }
      visited.add(hash);

      try {
        const commit = objects.readCommit(root, hash);
        const date = commit.authorDate
          ? new Date(commit.authorDate * 1000).toLocaleDateString()
          : '';
        const shortHash = commit.hash.slice(0, 10);

        const item = new CommitItem(
          `${commit.message}`,
          `${shortHash} by ${commit.authorName} on ${date}`,
          commit.hash,
        );
        commits.push(item);

        for (const parent of commit.parents) {
          if (!visited.has(parent)) { queue.push(parent); }
        }
      } catch { break; }
    }

    return commits;
  }
}

class CommitItem extends vscode.TreeItem {
  constructor(label: string, description: string, hash: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = hash;
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.contextValue = 'commit';
  }
}
