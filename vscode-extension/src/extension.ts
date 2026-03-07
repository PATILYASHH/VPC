import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SyncApiClient } from './api/client';
import { ChangesProvider } from './views/changesProvider';
import { MigrationsProvider } from './views/migrationsProvider';
import { HistoryProvider } from './views/historyProvider';
import { ConfigViewProvider } from './views/configViewProvider';
import { PullRequestsProvider } from './views/pullRequestsProvider';
import { pullCommand } from './commands/pull';
import { pushCommand } from './commands/push';

let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const client = new SyncApiClient();

  // Tree view providers
  const changesProvider = new ChangesProvider(client);
  const migrationsProvider = new MigrationsProvider(client);
  const historyProvider = new HistoryProvider(client);
  const pullRequestsProvider = new PullRequestsProvider(client);

  function refreshAll() {
    changesProvider.refresh();
    migrationsProvider.refresh();
    historyProvider.refresh();
    pullRequestsProvider.refresh();
    configViewProvider.refresh();
    refreshStatusBar(client);
  }

  // Config webview provider (sidebar UI for entering URL + API key)
  const configViewProvider = new ConfigViewProvider(client, () => refreshAll());
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ConfigViewProvider.viewType, configViewProvider),
  );

  // Register tree views
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('vpcSync.changes', changesProvider),
    vscode.window.registerTreeDataProvider('vpcSync.migrations', migrationsProvider),
    vscode.window.registerTreeDataProvider('vpcSync.history', historyProvider),
    vscode.window.registerTreeDataProvider('vpcSync.pullRequests', pullRequestsProvider),
  );

  // File system watcher for local migration files
  const migrationWatcher = vscode.workspace.createFileSystemWatcher('**/migrations/*.sql');
  migrationWatcher.onDidChange(() => migrationsProvider.refresh());
  migrationWatcher.onDidDelete(() => migrationsProvider.refresh());

  // Auto-detect new .sql files and prompt to push
  migrationWatcher.onDidCreate(async (uri) => {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get<string>('serverUrl');
    const key = config.get<string>('apiKey');

    if (!url || !key) {
      migrationsProvider.refresh();
      return;
    }

    // Wait briefly for the file write to complete
    await new Promise(resolve => setTimeout(resolve, 500));
    migrationsProvider.refresh();

    const fileName = path.basename(uri.fsPath);

    // Check if this file's content already matches a remote migration or PR
    // (i.e., it was pulled from the server, not created locally)
    try {
      const sql = fs.readFileSync(uri.fsPath, 'utf-8');
      const crypto = await import('crypto');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      const [migrationsResult, prResult] = await Promise.all([
        client.getMigrations(url, key, 1, 500),
        client.getPullRequests(url, key),
      ]);

      // Check if content matches any existing migration
      for (const m of migrationsResult.migrations || []) {
        const mHash = crypto.createHash('sha256').update(m.sql_up).digest('hex');
        if (mHash === checksum) { return; } // pulled file, no prompt
      }

      // Check if content matches any existing PR
      for (const pr of prResult.pull_requests || []) {
        const prHash = crypto.createHash('sha256').update(pr.sql_content).digest('hex');
        if (prHash === checksum) { return; } // already pushed
      }
    } catch {
      // Comparison failed, still show prompt
    }

    // This is a genuinely new file — prompt user
    const action = await vscode.window.showInformationMessage(
      `New migration detected: "${fileName}". Push to VPSHub as a Pull Request?`,
      'Push Now',
      'Ignore'
    );

    if (action === 'Push Now') {
      pushCommand(client, () => refreshAll(), uri.fsPath);
    }
  });

  context.subscriptions.push(migrationWatcher);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'vpcSync.pull';
  statusBar.tooltip = 'VPC Sync: Click to pull schema changes';
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('vpcSync.configure', () => {
      // Focus the config webview in the sidebar
      vscode.commands.executeCommand('vpcSync.config.focus');
    }),
    vscode.commands.registerCommand('vpcSync.pull', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pullAll', () => pullCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.push', () => pushCommand(client, () => refreshAll())),
    vscode.commands.registerCommand('vpcSync.pushFile', (item: any) => pushCommand(client, () => refreshAll(), item?.filePath)),
    vscode.commands.registerCommand('vpcSync.status', () => showStatus(client)),
    vscode.commands.registerCommand('vpcSync.refresh', () => refreshAll()),
    vscode.commands.registerCommand('vpcSync.selectFolder', () => selectOutputFolder()),
    vscode.commands.registerCommand('vpcSync.showSQL', (sql: string) => showSQL(sql)),
    vscode.commands.registerCommand('vpcSync.detectChanges', () => detectChanges(client, migrationsProvider, () => refreshAll())),
  );

  // Auto-refresh
  const intervalSec = vscode.workspace.getConfiguration('vpcSync').get<number>('autoRefreshInterval') || 30;
  if (intervalSec > 0) {
    const interval = setInterval(() => refreshAll(), intervalSec * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(interval) });
  }

  // Initial refresh
  refreshAll();
}

async function refreshStatusBar(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    statusBar.hide();
    return;
  }

  try {
    const status = await client.getStatus(url, key);
    const pending = status.pending_changes || 0;

    if (pending > 0) {
      statusBar.text = `$(cloud-download) VPC Sync: ${pending} pending`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBar.text = `$(check) VPC Sync: up to date`;
      statusBar.backgroundColor = undefined;
    }
    statusBar.show();
  } catch {
    statusBar.text = `$(warning) VPC Sync: offline`;
    statusBar.backgroundColor = undefined;
    statusBar.show();
  }
}

async function showStatus(client: SyncApiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration('vpcSync');
  const url = config.get<string>('serverUrl');
  const key = config.get<string>('apiKey');

  if (!url || !key) {
    vscode.window.showWarningMessage('VPC Sync not configured. Run "VPC Sync: Configure Connection" first.');
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

  if (uri && uri[0]) {
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

/**
 * Detect schema changes by comparing local SQL files with the remote database.
 * Shows which tables exist in local migrations but not in DB (and vice versa).
 */
async function detectChanges(
  client: SyncApiClient,
  migrationsProvider: MigrationsProvider,
  onComplete: () => void
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
        // Fetch remote schema and migrations
        const [schema, migrationsResult] = await Promise.all([
          client.getSchema(url, key),
          client.getMigrations(url, key, 1, 500),
        ]);

        const dbTableNames = new Set(schema.tables.map(t => t.name));
        const appliedMigrations = (migrationsResult.migrations || []).filter(m => m.status === 'applied');

        // Parse local SQL files for CREATE TABLE statements
        const outFolder = config.get<string>('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) { return; }

        const dir = path.resolve(workspaceRoot, outFolder);
        if (!fs.existsSync(dir)) {
          vscode.window.showInformationMessage('No local migrations folder found.');
          return;
        }

        const sqlFiles = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
        const localTableCreates = new Map<string, string>(); // table → file
        const localTableDrops = new Set<string>();
        const localAlters = new Map<string, string[]>(); // table → [file, ...]

        for (const file of sqlFiles) {
          const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
          const upper = sql.toUpperCase().replace(/\s+/g, ' ');

          // Find CREATE TABLE statements
          const createMatches = upper.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\S+)/g);
          for (const match of createMatches) {
            const tableName = match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, '');
            if (!tableName.startsWith('_vpc_')) {
              localTableCreates.set(tableName, file);
            }
          }

          // Find DROP TABLE statements
          const dropMatches = upper.matchAll(/DROP TABLE (?:IF EXISTS )?(\S+)/g);
          for (const match of dropMatches) {
            localTableDrops.add(match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, ''));
          }

          // Find ALTER TABLE statements
          const alterMatches = upper.matchAll(/ALTER TABLE (\S+)/g);
          for (const match of alterMatches) {
            const tableName = match[1].toLowerCase().replace(/^public\./, '').replace(/"/g, '');
            if (!localAlters.has(tableName)) { localAlters.set(tableName, []); }
            localAlters.get(tableName)!.push(file);
          }
        }

        // Build diff report
        const lines: string[] = [
          '-- VPC Sync: Schema Comparison Report',
          `-- Generated: ${new Date().toISOString()}`,
          `-- Database tables: ${dbTableNames.size}`,
          `-- Local CREATE TABLE statements: ${localTableCreates.size}`,
          '',
        ];

        // Tables in local SQL but not in DB (need to be pushed/applied)
        const missingInDb: string[] = [];
        for (const [table, file] of localTableCreates) {
          if (!dbTableNames.has(table) && !localTableDrops.has(table)) {
            missingInDb.push(`--   ${table}  (from ${file})`);
          }
        }

        if (missingInDb.length > 0) {
          lines.push(`-- TABLES IN LOCAL SQL BUT NOT IN DATABASE (${missingInDb.length}):`);
          lines.push('-- These need to be pushed and merged in VPSHub.');
          lines.push(...missingInDb);
          lines.push('');
        }

        // Tables in DB but not in any local SQL (created directly on DB)
        const missingInLocal: string[] = [];
        for (const table of dbTableNames) {
          if (!localTableCreates.has(table) && !table.startsWith('_vpc_')) {
            missingInLocal.push(`--   ${table}`);
          }
        }

        if (missingInLocal.length > 0) {
          lines.push(`-- TABLES IN DATABASE BUT NOT IN LOCAL SQL (${missingInLocal.length}):`);
          lines.push('-- These exist in the DB but have no local migration file.');
          lines.push('-- Use "Pull Schema Changes" to sync them locally.');
          lines.push(...missingInLocal);
          lines.push('');
        }

        // Unpushed local files
        const newFiles = migrationsProvider.getNewFiles();
        if (newFiles.length > 0) {
          lines.push(`-- UNPUSHED LOCAL FILES (${newFiles.length}):`);
          for (const f of newFiles) {
            lines.push(`--   ${f.name}`);
          }
          lines.push('');
        }

        // Applied migration count
        lines.push(`-- APPLIED MIGRATIONS: ${appliedMigrations.length}`);

        if (missingInDb.length === 0 && missingInLocal.length === 0 && newFiles.length === 0) {
          lines.push('');
          lines.push('-- Everything is in sync! No differences detected.');
        }

        // Show the report
        const doc = await vscode.workspace.openTextDocument({
          content: lines.join('\n'),
          language: 'sql',
        });
        await vscode.window.showTextDocument(doc, { preview: true });

        if (missingInDb.length > 0) {
          vscode.window.showWarningMessage(
            `${missingInDb.length} table(s) found in local SQL but not in database. Push your migrations to sync.`
          );
        } else if (missingInLocal.length > 0) {
          vscode.window.showInformationMessage(
            `${missingInLocal.length} table(s) in DB have no local migration. Pull to sync.`
          );
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
