/**
 * VPC VCS SCM Provider — Git-like Source Control
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as objects from '../vcs/objects';
import * as refs from '../vcs/refs';
import * as index from '../vcs/index';

export class VpcScmProvider implements vscode.Disposable {
  private scm: vscode.SourceControl;
  private staged: vscode.SourceControlResourceGroup;
  private changes: vscode.SourceControlResourceGroup;
  private untracked: vscode.SourceControlResourceGroup;
  private root: string;
  private refreshTimeout: NodeJS.Timeout | undefined;

  get inputBox(): vscode.SourceControlInputBox { return this.scm.inputBox; }

  constructor(root: string) {
    this.root = root;
    this.scm = vscode.scm.createSourceControl('vpc-sync', 'VPC Sync', vscode.Uri.file(root));
    this.scm.inputBox.placeholder = 'Commit message (Ctrl+Enter to commit)';
    this.scm.acceptInputCommand = { command: 'vpcSync.commit', title: 'Commit' };

    this.staged = this.scm.createResourceGroup('staged', 'Staged Changes');
    this.changes = this.scm.createResourceGroup('changes', 'Changes');
    this.untracked = this.scm.createResourceGroup('untracked', 'Untracked');

    this.staged.hideWhenEmpty = true;
    this.changes.hideWhenEmpty = true;
    this.untracked.hideWhenEmpty = true;
    this.scm.count = 0;
  }

  scheduleRefresh(): void {
    if (this.refreshTimeout) { clearTimeout(this.refreshTimeout); }
    this.refreshTimeout = setTimeout(() => this.refresh(), 500);
  }

  async refresh(): Promise<void> {
    if (!objects.hasVpcRepo(this.root)) { return; }
    try {
      const idx = index.readIndex(this.root);
      const indexMap = new Map(idx.entries.map(e => [e.path, e.hash]));

      const headHash = refs.resolveRef(this.root, 'HEAD');
      const headMap = new Map<string, string>();
      if (headHash) {
        try {
          const commit = objects.readCommit(this.root, headHash);
          for (const f of objects.walkTree(this.root, commit.tree)) { headMap.set(f.path, f.hash); }
        } catch { /* empty repo */ }
      }

      const workspaceFiles = index.getAllWorkspaceFiles(this.root);
      const workspaceSet = new Set(workspaceFiles);
      const workHashes = new Map<string, string>();
      for (const fp of workspaceFiles) {
        try {
          workHashes.set(fp, objects.hashObject('blob', fs.readFileSync(path.resolve(this.root, fp))));
        } catch { /* skip */ }
      }

      const stagedItems: vscode.SourceControlResourceState[] = [];
      const changedItems: vscode.SourceControlResourceState[] = [];
      const untrackedItems: vscode.SourceControlResourceState[] = [];

      // Staged: index vs HEAD
      for (const [fp, ih] of indexMap) {
        if (headMap.get(fp) !== ih) {
          const uri = vscode.Uri.file(path.resolve(this.root, fp));
          const isNew = !headMap.has(fp);
          stagedItems.push({ resourceUri: uri, decorations: { tooltip: isNew ? 'New file' : 'Modified', iconPath: new vscode.ThemeIcon(isNew ? 'diff-added' : 'diff-modified', new vscode.ThemeColor('gitDecoration.addedResourceForeground')) } });
        }
      }
      for (const [fp] of headMap) {
        if (!indexMap.has(fp)) {
          stagedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { strikeThrough: true, tooltip: 'Deleted', iconPath: new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')) } });
        }
      }

      // Changes: workspace vs index
      for (const [fp, ih] of indexMap) {
        if (!workspaceSet.has(fp)) {
          changedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { strikeThrough: true, tooltip: 'Deleted', iconPath: new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')) } });
        } else if (workHashes.get(fp) && workHashes.get(fp) !== ih) {
          changedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { tooltip: 'Modified', iconPath: new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')) } });
        }
      }

      // Untracked: in workspace but not in index/HEAD
      for (const fp of workspaceFiles) {
        if (!indexMap.has(fp) && !headMap.has(fp)) {
          untrackedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { tooltip: 'Untracked', iconPath: new vscode.ThemeIcon('question', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')) } });
        }
      }

      this.staged.resourceStates = stagedItems;
      this.changes.resourceStates = changedItems;
      this.untracked.resourceStates = untrackedItems;
      this.scm.count = stagedItems.length + changedItems.length;
    } catch (err) { console.error('[VPC SCM] Refresh error:', err); }
  }

  dispose(): void {
    this.scm.dispose();
    if (this.refreshTimeout) { clearTimeout(this.refreshTimeout); }
  }
}
