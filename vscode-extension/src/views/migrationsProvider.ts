import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { SyncApiClient, MigrationRecord } from '../api/client';

type SyncStatus = 'new' | 'pushed' | 'applied' | 'failed';

interface LocalFile {
  name: string;
  filePath: string;
  sizeKb: string;
  checksum: string;
  sql: string;
  syncStatus: SyncStatus;
  prNumber?: number;
  migrationVersion?: number;
}

export class MigrationsProvider implements vscode.TreeDataProvider<MigrationFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MigrationFileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private localFiles: LocalFile[] = [];
  private client: SyncApiClient;
  private remoteMigrations: MigrationRecord[] = [];
  private remotePRs: any[] = [];

  constructor(client: SyncApiClient) {
    this.client = client;
  }

  refresh(): void {
    this.loadFiles();
  }

  /** Get list of local files that have never been pushed */
  getNewFiles(): LocalFile[] {
    return this.localFiles.filter(f => f.syncStatus === 'new');
  }

  private async loadFiles(): Promise<void> {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const outFolder = config.get<string>('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
      this.localFiles = [];
      this._onDidChangeTreeData.fire(undefined);
      return;
    }

    const dir = path.resolve(workspaceRoot, outFolder);
    let fileNames: string[] = [];
    try {
      if (fs.existsSync(dir)) {
        fileNames = fs.readdirSync(dir)
          .filter(f => f.endsWith('.sql'))
          .sort()
          .reverse();
      }
    } catch {
      // ignore
    }

    // Read local files and compute checksums
    const locals: LocalFile[] = fileNames.map(f => {
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

    // Fetch remote state to compare
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (url && key) {
      try {
        const [migrationsResult, prResult] = await Promise.all([
          this.client.getMigrations(url, key, 1, 500),
          this.client.getPullRequests(url, key),
        ]);
        this.remoteMigrations = migrationsResult.migrations || [];
        this.remotePRs = prResult.pull_requests || [];
      } catch {
        // offline — keep all as 'new'
      }

      // Build lookup sets for matching
      const appliedChecksums = new Set<string>();
      const appliedNames = new Set<string>();
      const prSqlChecksums = new Map<string, any>();
      const prSqlNames = new Map<string, any>();

      for (const m of this.remoteMigrations) {
        if (m.status === 'applied' || m.status === 'pending') {
          const mChecksum = crypto.createHash('sha256').update(m.sql_up).digest('hex');
          appliedChecksums.add(mChecksum);
          // Normalize name: strip version prefix like "pr_1_" or "0001_"
          const normName = m.name.replace(/^\d+_/, '').replace(/^pr_\d+_/, '').toLowerCase();
          appliedNames.add(normName);
        }
      }

      for (const pr of this.remotePRs) {
        if (pr.status === 'merged') { continue; } // already covered by migrations
        const prChecksum = crypto.createHash('sha256').update(pr.sql_content).digest('hex');
        prSqlChecksums.set(prChecksum, pr);
        const normTitle = (pr.title || '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        prSqlNames.set(normTitle, pr);
      }

      // Match each local file
      for (const local of locals) {
        // Check if content matches an applied migration (by checksum)
        if (appliedChecksums.has(local.checksum)) {
          local.syncStatus = 'applied';
          const matchedMigration = this.remoteMigrations.find(
            m => crypto.createHash('sha256').update(m.sql_up).digest('hex') === local.checksum
          );
          if (matchedMigration) {
            local.migrationVersion = matchedMigration.version;
            if (matchedMigration.status === 'failed') {
              local.syncStatus = 'failed';
            }
          }
          continue;
        }

        // Check if content matches an open/testing PR (by checksum)
        const matchedPr = prSqlChecksums.get(local.checksum);
        if (matchedPr) {
          local.syncStatus = 'pushed';
          local.prNumber = matchedPr.pr_number;
          continue;
        }

        // Fallback: match by normalized file name
        const localNormName = path.basename(local.name, '.sql')
          .replace(/^\d+_/, '')
          .toLowerCase();

        if (appliedNames.has(localNormName)) {
          local.syncStatus = 'applied';
          continue;
        }

        const nameMatchPr = prSqlNames.get(localNormName);
        if (nameMatchPr) {
          local.syncStatus = 'pushed';
          local.prNumber = nameMatchPr.pr_number;
          continue;
        }

        // No match — it's new
        local.syncStatus = 'new';
      }
    }

    this.localFiles = locals;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MigrationFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MigrationFileItem[] {
    if (this.localFiles.length === 0) {
      return [new MigrationFileItem('No local migrations', '', vscode.TreeItemCollapsibleState.None, 'empty')];
    }

    return this.localFiles.map(f => {
      let desc = `${f.sizeKb} KB`;
      let status: string = f.syncStatus;

      switch (f.syncStatus) {
        case 'applied':
          desc = `Applied${f.migrationVersion ? ` (v${f.migrationVersion})` : ''} · ${f.sizeKb} KB`;
          break;
        case 'pushed':
          desc = `PR #${f.prNumber || '?'} · ${f.sizeKb} KB`;
          break;
        case 'failed':
          desc = `Failed · ${f.sizeKb} KB`;
          break;
        case 'new':
          desc = `New · ${f.sizeKb} KB`;
          break;
      }

      return new MigrationFileItem(f.name, desc, vscode.TreeItemCollapsibleState.None, status, f.filePath);
    });
  }
}

export class MigrationFileItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    status: string,
    public readonly filePath?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;

    switch (status) {
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'empty';
        break;
      case 'new':
        this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('charts.green'));
        this.contextValue = 'newMigration';
        this.tooltip = `${filePath}\n\nNew — not yet pushed to VPSHub`;
        break;
      case 'pushed':
        this.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.yellow'));
        this.contextValue = 'pushedMigration';
        this.tooltip = `${filePath}\n\nPR created — pending review in VPSHub`;
        break;
      case 'applied':
        this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        this.contextValue = 'appliedMigration';
        this.tooltip = `${filePath}\n\nApplied to database`;
        break;
      case 'failed':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        this.contextValue = 'failedMigration';
        this.tooltip = `${filePath}\n\nMigration failed — check VPSHub`;
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.contextValue = 'pendingMigration';
        break;
    }

    if (filePath) {
      this.command = {
        command: 'vscode.open',
        title: 'Open Migration',
        arguments: [vscode.Uri.file(filePath)],
      };
    }
  }
}
