import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SyncApiClient, SchemaChange, MigrationRecord } from '../api/client';
import { VpcFileDecorationProvider } from './fileDecorationProvider';
import { VpcOriginalContentProvider } from './quickDiffProvider';

export type SyncStatus = 'new' | 'staged' | 'pushed' | 'applied' | 'failed' | 'pendingRemote';

export interface LocalFile {
  name: string;
  filePath: string;
  sizeKb: string;
  checksum: string;
  sql: string;
  syncStatus: SyncStatus;
  prNumber?: number;
  migrationVersion?: number;
}

export class VpcScmProvider implements vscode.Disposable {
  private scm: vscode.SourceControl;
  private readyToPushGroup: vscode.SourceControlResourceGroup;
  private newMigrationsGroup: vscode.SourceControlResourceGroup;
  private inReviewGroup: vscode.SourceControlResourceGroup;
  private pendingRemoteGroup: vscode.SourceControlResourceGroup;

  private stagedFiles: Set<string>;
  private localFiles: LocalFile[] = [];
  private remoteChanges: SchemaChange[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(
    private client: SyncApiClient,
    private context: vscode.ExtensionContext,
    private fileDecorationProvider: VpcFileDecorationProvider,
    private originalContentProvider: VpcOriginalContentProvider,
  ) {
    const rootUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    this.scm = vscode.scm.createSourceControl('vpc-sync', 'VPC Sync', rootUri);
    this.scm.inputBox.placeholder = 'PR title (Enter to push staged migrations)';
    this.scm.acceptInputCommand = {
      command: 'vpcSync.pushAll',
      title: 'Push Staged Migrations',
    };

    // Resource groups
    this.readyToPushGroup = this.scm.createResourceGroup('readyToPush', 'Ready to Push');
    this.readyToPushGroup.hideWhenEmpty = true;

    this.newMigrationsGroup = this.scm.createResourceGroup('newMigrations', 'New Migrations');
    this.newMigrationsGroup.hideWhenEmpty = true;

    this.inReviewGroup = this.scm.createResourceGroup('inReview', 'In Review');
    this.inReviewGroup.hideWhenEmpty = true;

    this.pendingRemoteGroup = this.scm.createResourceGroup('pendingRemote', 'Pending Remote');
    this.pendingRemoteGroup.hideWhenEmpty = true;

    // Restore staged files from workspace state
    const saved = context.workspaceState.get<string[]>('vpc.stagedFiles', []);
    this.stagedFiles = new Set(saved);

    this.disposables.push(this.scm);
  }

  // ─── Public API ───────────────────────────────────────────

  async refresh(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');
    const outFolder = config.get<string>('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot || !url || !key) {
      this.clearAll();
      return;
    }

    // Read local files
    const dir = path.resolve(workspaceRoot, outFolder);
    this.localFiles = this.readLocalFiles(dir);

    // Fetch remote state
    let remoteMigrations: MigrationRecord[] = [];
    let remotePRs: any[] = [];
    this.remoteChanges = [];

    try {
      const [migrationsResult, prResult, changesResult] = await Promise.all([
        this.client.getMigrations(url, key, 1, 500),
        this.client.getPullRequests(url, key),
        this.client.getChanges(url, key),
      ]);
      remoteMigrations = migrationsResult.migrations || [];
      remotePRs = prResult.pull_requests || [];
      this.remoteChanges = changesResult.changes || [];
    } catch {
      // Offline — leave all as 'new'
    }

    // Classify local files
    this.classifyFiles(remoteMigrations, remotePRs);

    // Build original content map for quick diff
    const originals = new Map<string, string>();
    for (const local of this.localFiles) {
      if (local.syncStatus === 'applied' || local.syncStatus === 'pushed') {
        const match = remoteMigrations.find(m =>
          crypto.createHash('sha256').update(m.sql_up).digest('hex') === local.checksum
        );
        if (match) {
          originals.set(local.filePath, match.sql_up);
        }
      }
    }
    this.originalContentProvider.updateOriginals(originals);

    // Update resource groups
    this.updateResourceGroups();

    // Update file decorations
    const statuses = new Map<string, SyncStatus>();
    for (const f of this.localFiles) {
      const status = this.stagedFiles.has(f.filePath) && f.syncStatus === 'new' ? 'staged' : f.syncStatus;
      statuses.set(f.filePath, status);
    }
    this.fileDecorationProvider.updateStatuses(statuses);

    // Update badge and status bar
    const toPush = this.localFiles.filter(f => f.syncStatus === 'new').length;
    const toPull = this.remoteChanges.length;
    this.scm.count = toPush + toPull;
    this.scm.statusBarCommands = [{
      command: 'vpcSync.status',
      title: `$(database) VPC: \u2191${toPush} \u2193${toPull}`,
      tooltip: `${toPush} to push, ${toPull} to pull`,
    }];
  }

  stage(uri: vscode.Uri): void {
    this.stagedFiles.add(uri.fsPath);
    this.persistStaged();
    this.updateResourceGroups();
    this.updateDecorations();
  }

  unstage(uri: vscode.Uri): void {
    this.stagedFiles.delete(uri.fsPath);
    this.persistStaged();
    this.updateResourceGroups();
    this.updateDecorations();
  }

  stageAll(): void {
    for (const f of this.localFiles) {
      if (f.syncStatus === 'new') {
        this.stagedFiles.add(f.filePath);
      }
    }
    this.persistStaged();
    this.updateResourceGroups();
    this.updateDecorations();
  }

  unstageAll(): void {
    this.stagedFiles.clear();
    this.persistStaged();
    this.updateResourceGroups();
    this.updateDecorations();
  }

  getStagedFiles(): LocalFile[] {
    return this.localFiles.filter(f => this.stagedFiles.has(f.filePath) && f.syncStatus === 'new');
  }

  getNewFiles(): LocalFile[] {
    return this.localFiles.filter(f => f.syncStatus === 'new');
  }

  getInputBoxValue(): string {
    return this.scm.inputBox.value;
  }

  clearInputBox(): void {
    this.scm.inputBox.value = '';
  }

  clearStaged(): void {
    this.stagedFiles.clear();
    this.persistStaged();
  }

  // ─── Private Methods ──────────────────────────────────────

  private readLocalFiles(dir: string): LocalFile[] {
    if (!fs.existsSync(dir)) { return []; }

    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()
        .reverse()
        .map(f => {
          const filePath = path.join(dir, f);
          const sql = fs.readFileSync(filePath, 'utf-8');
          const stat = fs.statSync(filePath);
          const checksum = crypto.createHash('sha256').update(sql).digest('hex');
          return {
            name: f,
            filePath,
            sizeKb: (stat.size / 1024).toFixed(1),
            checksum,
            sql,
            syncStatus: 'new' as SyncStatus,
          };
        });
    } catch {
      return [];
    }
  }

  private classifyFiles(remoteMigrations: MigrationRecord[], remotePRs: any[]): void {
    const appliedChecksums = new Set<string>();
    const appliedNames = new Set<string>();
    const failedChecksums = new Set<string>();
    const prChecksums = new Map<string, any>();
    const prNames = new Map<string, any>();

    for (const m of remoteMigrations) {
      const hash = crypto.createHash('sha256').update(m.sql_up).digest('hex');
      if (m.status === 'failed') {
        failedChecksums.add(hash);
      } else {
        appliedChecksums.add(hash);
        const normName = m.name.replace(/^\d+_/, '').replace(/^pr_\d+_/, '').toLowerCase();
        appliedNames.add(normName);
      }
    }

    for (const pr of remotePRs) {
      if (pr.status === 'merged') { continue; }
      const hash = crypto.createHash('sha256').update(pr.sql_content).digest('hex');
      prChecksums.set(hash, pr);
      const normTitle = (pr.title || '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      prNames.set(normTitle, pr);
    }

    for (const local of this.localFiles) {
      if (failedChecksums.has(local.checksum)) {
        local.syncStatus = 'failed';
        continue;
      }
      if (appliedChecksums.has(local.checksum)) {
        local.syncStatus = 'applied';
        const match = remoteMigrations.find(m =>
          crypto.createHash('sha256').update(m.sql_up).digest('hex') === local.checksum
        );
        if (match) { local.migrationVersion = match.version; }
        continue;
      }

      const matchedPr = prChecksums.get(local.checksum);
      if (matchedPr) {
        local.syncStatus = 'pushed';
        local.prNumber = matchedPr.pr_number;
        continue;
      }

      // Name-based fallback
      const normName = path.basename(local.name, '.sql').replace(/^\d+_/, '').toLowerCase();
      if (appliedNames.has(normName)) {
        local.syncStatus = 'applied';
        continue;
      }
      const nameMatchPr = prNames.get(normName);
      if (nameMatchPr) {
        local.syncStatus = 'pushed';
        local.prNumber = nameMatchPr.pr_number;
        continue;
      }

      local.syncStatus = 'new';
    }
  }

  private updateResourceGroups(): void {
    const ready: vscode.SourceControlResourceState[] = [];
    const newMigs: vscode.SourceControlResourceState[] = [];
    const inReview: vscode.SourceControlResourceState[] = [];

    for (const f of this.localFiles) {
      const uri = vscode.Uri.file(f.filePath);
      const state: vscode.SourceControlResourceState = {
        resourceUri: uri,
        command: {
          command: 'vpcSync.openResourceDiff',
          title: 'Open Diff',
          arguments: [uri],
        },
        decorations: this.getDecorations(f),
      };

      if (f.syncStatus === 'new' && this.stagedFiles.has(f.filePath)) {
        ready.push(state);
      } else if (f.syncStatus === 'new') {
        newMigs.push(state);
      } else if (f.syncStatus === 'pushed') {
        inReview.push(state);
      }
      // applied/failed files are not shown in SCM (they're done)
    }

    // Pending remote changes
    const pending: vscode.SourceControlResourceState[] = this.remoteChanges.map(c => {
      const virtualUri = vscode.Uri.parse(`vpc-change:/${c.object_identity || 'change'}-${c.id}.sql`);
      return {
        resourceUri: virtualUri,
        command: {
          command: 'vpcSync.showSQL',
          title: 'Show SQL',
          arguments: [c.ddl_command],
        },
        decorations: {
          tooltip: `${c.event_type} ${c.object_type || ''}: ${c.object_identity}\n${c.ddl_command.substring(0, 300)}`,
          iconPath: this.getRemoteChangeIcon(c),
          strikeThrough: false,
        },
      };
    });

    this.readyToPushGroup.resourceStates = ready;
    this.newMigrationsGroup.resourceStates = newMigs;
    this.inReviewGroup.resourceStates = inReview;
    this.pendingRemoteGroup.resourceStates = pending;
  }

  private getDecorations(file: LocalFile): vscode.SourceControlResourceDecorations {
    switch (file.syncStatus) {
      case 'new':
        return {
          tooltip: `New migration — not yet pushed\n${file.sizeKb} KB`,
          iconPath: new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('charts.green')),
        };
      case 'pushed':
        return {
          tooltip: `PR #${file.prNumber || '?'} — in review\n${file.sizeKb} KB`,
          iconPath: new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.yellow')),
        };
      case 'applied':
        return {
          tooltip: `Applied to database${file.migrationVersion ? ` (v${file.migrationVersion})` : ''}\n${file.sizeKb} KB`,
          faded: true,
          iconPath: new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green')),
        };
      case 'failed':
        return {
          tooltip: `Migration failed\n${file.sizeKb} KB`,
          iconPath: new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')),
        };
      default:
        return {
          tooltip: file.name,
          iconPath: new vscode.ThemeIcon('file-code'),
        };
    }
  }

  private getRemoteChangeIcon(change: SchemaChange): vscode.ThemeIcon {
    const type = (change.object_type || '').toLowerCase();
    if (type.includes('table')) { return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.blue')); }
    if (type.includes('index')) { return new vscode.ThemeIcon('symbol-key', new vscode.ThemeColor('charts.blue')); }
    if (type.includes('function')) { return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.blue')); }
    if (type.includes('view')) { return new vscode.ThemeIcon('symbol-interface', new vscode.ThemeColor('charts.blue')); }

    const event = change.event_type.toUpperCase();
    if (event === 'DROP') { return new vscode.ThemeIcon('trash', new vscode.ThemeColor('charts.red')); }
    if (event.includes('ALTER')) { return new vscode.ThemeIcon('edit', new vscode.ThemeColor('charts.yellow')); }
    return new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green'));
  }

  private updateDecorations(): void {
    const statuses = new Map<string, SyncStatus>();
    for (const f of this.localFiles) {
      const status = this.stagedFiles.has(f.filePath) && f.syncStatus === 'new' ? 'staged' : f.syncStatus;
      statuses.set(f.filePath, status);
    }
    this.fileDecorationProvider.updateStatuses(statuses);
  }

  private persistStaged(): void {
    this.context.workspaceState.update('vpc.stagedFiles', [...this.stagedFiles]);
  }

  private clearAll(): void {
    this.readyToPushGroup.resourceStates = [];
    this.newMigrationsGroup.resourceStates = [];
    this.inReviewGroup.resourceStates = [];
    this.pendingRemoteGroup.resourceStates = [];
    this.scm.count = 0;
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
  }
}
