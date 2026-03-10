import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SyncApiClient } from './api/client';
import { VpcScmProvider } from './scm/vpcScmProvider';
import { VpcFileDecorationProvider } from './scm/fileDecorationProvider';
import { VpcQuickDiffProvider, VpcOriginalContentProvider } from './scm/quickDiffProvider';
import { HistoryProvider } from './views/historyProvider';
import { ConfigViewProvider } from './views/configViewProvider';
import { PullRequestsProvider } from './views/pullRequestsProvider';
import { SyncActionsProvider } from './views/syncActionsProvider';
import { pullCommand } from './commands/pull';
import { pushCommand, pushAllCommand } from './commands/push';
import { registerStageCommands } from './commands/stage';
import { newMigrationCommand } from './commands/newMigration';

export function activate(context: vscode.ExtensionContext) {
  const client = new SyncApiClient();

  // ─── SCM Provider (native Source Control panel) ───────────
  const fileDecorationProvider = new VpcFileDecorationProvider();
  const originalContentProvider = new VpcOriginalContentProvider();
  const scmProvider = new VpcScmProvider(client, context, fileDecorationProvider, originalContentProvider);

  context.subscriptions.push(
    scmProvider,
    vscode.window.registerFileDecorationProvider(fileDecorationProvider),
    vscode.workspace.registerTextDocumentContentProvider('vpc-original', originalContentProvider),
  );

  // ─── Supplementary tree views (VPC Sync panel) ────────────
  const historyProvider = new HistoryProvider(client);
  const pullRequestsProvider = new PullRequestsProvider(client);
  const configViewProvider = new ConfigViewProvider(client, () => refreshAll());
  const syncActionsProvider = new SyncActionsProvider(client, () => refreshAll());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SyncActionsProvider.viewType, syncActionsProvider),
    vscode.window.registerWebviewViewProvider(ConfigViewProvider.viewType, configViewProvider),
    vscode.window.registerTreeDataProvider('vpcSync.pullRequests', pullRequestsProvider),
    vscode.window.registerTreeDataProvider('vpcSync.history', historyProvider),
  );

  function refreshAll() {
    scmProvider.refresh();
    historyProvider.refresh();
    pullRequestsProvider.refresh();
    configViewProvider.refresh();
    syncActionsProvider.refresh();
  }

  // ─── Stage/Unstage commands ───────────────────────────────
  registerStageCommands(context, scmProvider);

  // ─── File system watcher ──────────────────────────────────
  const migrationWatcher = vscode.workspace.createFileSystemWatcher('**/migrations/*.sql');
  migrationWatcher.onDidChange(() => scmProvider.refresh());
  migrationWatcher.onDidCreate(() => scmProvider.refresh());
  migrationWatcher.onDidDelete(() => scmProvider.refresh());
  context.subscriptions.push(migrationWatcher);

  // ─── Commands ─────────────────────────────────────────────
  context.subscriptions.push(
    // Config
    vscode.commands.registerCommand('vpcSync.configure', () => {
      vscode.commands.executeCommand('vpcSync.config.focus');
    }),

    // Pull / Push
    vscode.commands.registerCommand('vpcSync.pull', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pullAll', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.push', () => pushCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pushAll', () => pushAllCommand(client, scmProvider, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pushFile', (resource: any) => {
      const filePath = resource?.resourceUri?.fsPath || resource?.filePath;
      pushCommand(client, () => refreshAll(), filePath);
    }),

    // New migration
    vscode.commands.registerCommand('vpcSync.newMigration', () => newMigrationCommand()),

    // Refresh / Status
    vscode.commands.registerCommand('vpcSync.refresh', () => refreshAll()),
    vscode.commands.registerCommand('vpcSync.status', () => showStatus(client)),
    vscode.commands.registerCommand('vpcSync.selectFolder', () => selectOutputFolder()),

    // SQL viewer
    vscode.commands.registerCommand('vpcSync.showSQL', (sql: string) => showSQL(sql)),

    // Diff commands
    vscode.commands.registerCommand('vpcSync.openResourceDiff', (uri: vscode.Uri) => {
      const originalUri = vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
      vscode.commands.executeCommand(
        'vscode.diff', originalUri, uri,
        `${path.basename(uri.fsPath)} (Remote \u2194 Local)`
      );
    }),
    vscode.commands.registerCommand('vpcSync.diffWithRemote', (resource: vscode.SourceControlResourceState) => {
      const uri = resource.resourceUri;
      const originalUri = vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
      vscode.commands.executeCommand(
        'vscode.diff', originalUri, uri,
        `${path.basename(uri.fsPath)} (Remote \u2194 Local)`
      );
    }),
    vscode.commands.registerCommand('vpcSync.openFile', (resource: vscode.SourceControlResourceState) => {
      vscode.commands.executeCommand('vscode.open', resource.resourceUri);
    }),

    // Detect changes
    vscode.commands.registerCommand('vpcSync.detectChanges', () => detectChanges(client, scmProvider, () => refreshAll())),

    // Sync Actions panel commands
    vscode.commands.registerCommand('vpcSync.commitAndPush', () => {
      vscode.commands.executeCommand('vpcSync.syncActions.focus');
    }),
    vscode.commands.registerCommand('vpcSync.pullDatabase', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.compareSchema', () => detectChanges(client, scmProvider, () => refreshAll())),
  );

  // ─── Auto-refresh ─────────────────────────────────────────
  const intervalSec = vscode.workspace.getConfiguration('vpcSync').get<number>('autoRefreshInterval') || 30;
  if (intervalSec > 0) {
    const interval = setInterval(() => refreshAll(), intervalSec * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }

  refreshAll();
}

// ─── Helper functions ─────────────────────────────────────────

async function showStatus(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    vscode.window.showWarningMessage('VPC Sync not configured.');
    return;
  }

  try {
    const status = await client.getStatus(url, key);
    vscode.window.showInformationMessage(
      `Project: ${status.project.name} | Tracking: ${status.tracking_enabled ? 'ON' : 'OFF'} | Pending: ${status.pending_changes} | Migrations: ${status.total_migrations}`
    );
  } catch (err: any) {
    vscode.window.showErrorMessage(`Status failed: ${err.message}`);
  }
}

async function selectOutputFolder(): Promise<void> {
  const uri = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Migration Output Folder',
  });

  if (uri?.[0]) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const relativePath = vscode.workspace.asRelativePath(uri[0]);
    await config.update('outputFolder', relativePath, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`Output folder set to: ${relativePath}`);
  }
}

async function showSQL(sql: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: sql, language: 'sql' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function detectChanges(
  client: SyncApiClient,
  scmProvider: VpcScmProvider,
  onComplete: () => void,
): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    vscode.window.showWarningMessage('VPC Sync not configured.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'VPC Sync', cancellable: false },
    async (progress) => {
      progress.report({ message: 'Comparing local files with database schema...' });

      try {
        const [schema, migrationsResult] = await Promise.all([
          client.getSchema(url, key),
          client.getMigrations(url, key, 1, 500),
        ]);

        const dbTableNames = new Set(schema.tables.map(t => t.name));
        const appliedMigrations = (migrationsResult.migrations || []).filter(m => m.status === 'applied');

        const outFolder = config.get<string>('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { return; }

        const dir = path.resolve(workspaceRoot, outFolder);
        if (!fs.existsSync(dir)) {
          vscode.window.showInformationMessage('No local migrations folder found.');
          return;
        }

        const sqlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
        const localTableCreates = new Map<string, string>();
        const localTableDrops = new Set<string>();

        for (const file of sqlFiles) {
          const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
          const upper = sql.toUpperCase().replace(/\s+/g, ' ');

          for (const match of upper.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\S+)/g)) {
            const table = match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, '');
            if (!table.startsWith('_vpc_')) { localTableCreates.set(table, file); }
          }
          for (const match of upper.matchAll(/DROP TABLE (?:IF EXISTS )?(\S+)/g)) {
            localTableDrops.add(match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, ''));
          }
        }

        const lines: string[] = [
          '-- VPC Sync: Schema Comparison Report',
          `-- Generated: ${new Date().toISOString()}`,
          `-- Database tables: ${dbTableNames.size}`,
          `-- Local CREATE TABLE statements: ${localTableCreates.size}`,
          '',
        ];

        const missingInDb: string[] = [];
        for (const [table, file] of localTableCreates) {
          if (!dbTableNames.has(table) && !localTableDrops.has(table)) {
            missingInDb.push(`--   ${table}  (from ${file})`);
          }
        }

        if (missingInDb.length > 0) {
          lines.push(`-- TABLES IN LOCAL SQL BUT NOT IN DATABASE (${missingInDb.length}):`);
          lines.push(...missingInDb, '');
        }

        const missingInLocal: string[] = [];
        for (const table of dbTableNames) {
          if (!localTableCreates.has(table) && !table.startsWith('_vpc_')) {
            missingInLocal.push(`--   ${table}`);
          }
        }

        if (missingInLocal.length > 0) {
          lines.push(`-- TABLES IN DATABASE BUT NOT IN LOCAL SQL (${missingInLocal.length}):`);
          lines.push(...missingInLocal, '');
        }

        const newFiles = scmProvider.getNewFiles();
        if (newFiles.length > 0) {
          lines.push(`-- UNPUSHED LOCAL FILES (${newFiles.length}):`);
          for (const f of newFiles) { lines.push(`--   ${f.name}`); }
          lines.push('');
        }

        lines.push(`-- APPLIED MIGRATIONS: ${appliedMigrations.length}`);

        if (missingInDb.length === 0 && missingInLocal.length === 0 && newFiles.length === 0) {
          lines.push('', '-- Everything is in sync!');
        }

        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'sql' });
        await vscode.window.showTextDocument(doc, { preview: true });

        if (missingInDb.length > 0) {
          vscode.window.showWarningMessage(`${missingInDb.length} table(s) in local SQL but not in DB.`);
        } else if (missingInLocal.length > 0) {
          vscode.window.showInformationMessage(`${missingInLocal.length} table(s) in DB but not in local SQL.`);
        } else {
          vscode.window.showInformationMessage('Schema is in sync!');
        }

        onComplete();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Detect failed: ${err.message}`);
      }
    }
  );
}

export function deactivate() {}
