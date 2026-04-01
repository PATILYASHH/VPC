/**
 * VPC Sync — Git-like SCM extension for VPC VCS
 *
 * Compact design: only native SCM panel + status bar.
 * No webviews. Fast activation. Like Git.
 */

import * as vscode from 'vscode';
import { SyncApiClient } from './api/client';
import { VpcScmProvider } from './scm/vpcScmProvider';
import { PanelProvider } from './views/panelProvider';
import * as objects from './vcs/objects';
import * as refs from './vcs/refs';
import * as index from './vcs/index';
import * as sync from './vcs/sync';

let scmProvider: VpcScmProvider | undefined;
let client: SyncApiClient;
let panel: PanelProvider;
let branchItem: vscode.StatusBarItem;
let syncItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;

export function activate(ctx: vscode.ExtensionContext) {
  client = new SyncApiClient();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Status bar
  branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  branchItem.command = 'vpcSync.connect';
  ctx.subscriptions.push(branchItem);
  syncItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  ctx.subscriptions.push(syncItem);

  // Sidebar panel (single webview — connection form + push/pull)
  panel = new PanelProvider(client, ctx, () => initScm(ctx));
  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider('vpcSync.panel', panel),
  );

  // ─── Commands ──────────────────────────────────────────

  ctx.subscriptions.push(
    vscode.commands.registerCommand('vpcSync.connect', () => {
      vscode.commands.executeCommand('vpcSync.panel.focus');
    }),

    // Refresh
    vscode.commands.registerCommand('vpcSync.refresh', () => {
      scmProvider?.refresh();
      panel.refresh();
      updateStatusBar();
    }),

    // Commit
    vscode.commands.registerCommand('vpcSync.commit', () => doCommit()),

    // Push
    vscode.commands.registerCommand('vpcSync.push', () => doPush()),

    // Pull
    vscode.commands.registerCommand('vpcSync.pull', () => doPull()),

    // Stage file
    vscode.commands.registerCommand('vpcSync.stageFile', (res: vscode.SourceControlResourceState) => {
      if (!root || !res) return;
      index.stageFile(root, vscode.workspace.asRelativePath(res.resourceUri));
      scmProvider?.refresh();
    }),

    // Unstage file
    vscode.commands.registerCommand('vpcSync.unstageFile', (res: vscode.SourceControlResourceState) => {
      if (!root || !res) return;
      const fp = vscode.workspace.asRelativePath(res.resourceUri);
      const head = refs.resolveRef(root, 'HEAD');
      if (head) {
        const manifest = objects.walkTree(root, objects.readCommit(root, head).tree);
        const entry = manifest.find(f => f.path === fp);
        if (entry) {
          const idx = index.readIndex(root);
          const i = idx.entries.findIndex(e => e.path === fp);
          if (i >= 0) idx.entries[i].hash = entry.hash;
          else idx.entries.push({ path: fp, hash: entry.hash, mode: entry.mode, size: 0, mtime: Date.now() });
          index.writeIndex(root, idx);
        } else {
          index.unstageFile(root, fp);
        }
      }
      scmProvider?.refresh();
    }),

    // Stage all
    vscode.commands.registerCommand('vpcSync.stageAll', () => {
      if (!root) return;
      index.stageAllFiles(root);
      scmProvider?.refresh();
    }),

    // Unstage all
    vscode.commands.registerCommand('vpcSync.unstageAll', () => {
      if (!root) return;
      const head = refs.resolveRef(root, 'HEAD');
      if (head) index.buildIndexFromTree(root, objects.readCommit(root, head).tree);
      scmProvider?.refresh();
    }),

    // Open file
    vscode.commands.registerCommand('vpcSync.openFile', async (res: vscode.SourceControlResourceState) => {
      if (res) vscode.window.showTextDocument(await vscode.workspace.openTextDocument(res.resourceUri));
    }),

    // Discard
    vscode.commands.registerCommand('vpcSync.discardFile', async (res: vscode.SourceControlResourceState) => {
      if (!root || !res) return;
      const fp = vscode.workspace.asRelativePath(res.resourceUri);
      const ok = await vscode.window.showWarningMessage(`Discard changes to ${fp}?`, { modal: true }, 'Discard');
      if (ok !== 'Discard') return;
      const idx = index.readIndex(root);
      const entry = idx.entries.find(e => e.path === fp);
      if (entry) {
        try {
          require('fs').writeFileSync(require('path').resolve(root, fp), objects.readBlob(root, entry.hash));
        } catch {}
      }
      scmProvider?.refresh();
    }),
  );

  // ─── Init ──────────────────────────────────────────────

  if (root && objects.hasVpcRepo(root)) {
    initScm(ctx);
  } else {
    branchItem.text = '$(plug) VPC Sync';
    branchItem.tooltip = 'Connect to VPSHub';
    branchItem.show();
  }

  // Auto-refresh
  const interval = vscode.workspace.getConfiguration('vpcSync').get<number>('autoRefreshInterval') || 0;
  if (interval > 0) {
    timer = setInterval(() => vscode.commands.executeCommand('vpcSync.refresh'), interval * 1000);
  }

  // File watcher — debounced
  if (root) {
    const w = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    const kick = () => scmProvider?.scheduleRefresh();
    w.onDidChange(kick); w.onDidCreate(kick); w.onDidDelete(kick);
    ctx.subscriptions.push(w);
  }
}

// ─── SCM Init ────────────────────────────────────────────

function initScm(ctx: vscode.ExtensionContext) {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  if (!scmProvider) {
    scmProvider = new VpcScmProvider(root);
    ctx.subscriptions.push(scmProvider);
  }
  scmProvider.refresh();
  updateStatusBar();
}

// ─── Commit ──────────────────────────────────────────────

async function doCommit() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !scmProvider) return;

  let message = scmProvider.inputBox.value?.trim();
  if (!message) {
    message = await vscode.window.showInputBox({ prompt: 'Commit message' }) || '';
    if (!message.trim()) return;
  }

  const idx = index.readIndex(root);
  const headHash = refs.resolveRef(root, 'HEAD');
  let hasChanges = false;

  if (headHash) {
    const headMap = new Map(objects.walkTree(root, objects.readCommit(root, headHash).tree).map(f => [f.path, f.hash]));
    const idxMap = new Map(idx.entries.map(e => [e.path, e.hash]));
    for (const [p, h] of idxMap) { if (headMap.get(p) !== h) { hasChanges = true; break; } }
    if (!hasChanges) for (const [p] of headMap) { if (!idxMap.has(p)) { hasChanges = true; break; } }
  } else {
    hasChanges = idx.entries.length > 0;
  }

  if (!hasChanges) { vscode.window.showInformationMessage('Nothing to commit.'); return; }

  const treeHash = objects.buildTreeFromFiles(root, idx.entries);
  const username = vscode.workspace.getConfiguration('vpcSync').get<string>('username') || 'user';
  const hash = objects.createCommit(root, {
    tree: treeHash,
    parents: headHash ? [headHash] : [],
    authorName: username,
    authorEmail: `${username}@vpc`,
    message,
  });

  const head = refs.readHead(root);
  if (head.symbolic && head.ref) refs.updateRef(root, head.ref, hash);
  else refs.writeHead(root, hash);

  scmProvider.inputBox.value = '';
  vscode.window.showInformationMessage(`${hash.slice(0, 8)}: ${message}`);
  scmProvider.refresh();
  updateStatusBar();
}

// ─── Push ────────────────────────────────────────────────

async function doPush() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pushing...' }, async () => {
    try {
      const r = await sync.push(root, client);
      vscode.window.showInformationMessage(r.message);
    } catch (e: any) { vscode.window.showErrorMessage(`Push: ${e.message}`); }
    scmProvider?.refresh();
    updateStatusBar();
  });
}

// ─── Pull ────────────────────────────────────────────────

async function doPull() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Pulling...' }, async () => {
    try {
      const r = await sync.pull(root, client);
      vscode.window.showInformationMessage(r.message);
    } catch (e: any) { vscode.window.showErrorMessage(`Pull: ${e.message}`); }
    scmProvider?.refresh();
    updateStatusBar();
  });
}

// ─── Status Bar ──────────────────────────────────────────

function updateStatusBar() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !objects.hasVpcRepo(root)) { branchItem.text = '$(plug) VPC Sync'; branchItem.show(); syncItem.hide(); return; }

  const branch = refs.getCurrentBranch(root);
  branchItem.text = `$(git-branch) ${branch || 'detached'}`;
  branchItem.tooltip = 'VPC Sync';
  branchItem.show();

  try {
    const s = sync.getSyncStatus(root);
    const parts: string[] = [];
    if (s.ahead > 0) parts.push(`${s.ahead}$(arrow-up)`);
    if (s.behind > 0) parts.push(`${s.behind}$(arrow-down)`);
    syncItem.text = parts.length > 0 ? parts.join(' ') : '$(check)';
    syncItem.tooltip = parts.length > 0 ? `${s.ahead} to push, ${s.behind} to pull` : 'Up to date';
    syncItem.command = s.behind > 0 ? 'vpcSync.pull' : 'vpcSync.push';
    syncItem.show();
  } catch { syncItem.hide(); }
}

export function deactivate() { if (timer) clearInterval(timer); }
