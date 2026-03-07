"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationFileItem = exports.MigrationsProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
class MigrationsProvider {
    constructor(client) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.localFiles = [];
        this.remoteMigrations = [];
        this.remotePRs = [];
        this.client = client;
    }
    refresh() {
        this.loadFiles();
    }
    /** Get list of local files that have never been pushed */
    getNewFiles() {
        return this.localFiles.filter(f => f.syncStatus === 'new');
    }
    async loadFiles() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            this.localFiles = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        const dir = path.resolve(workspaceRoot, outFolder);
        let fileNames = [];
        try {
            if (fs.existsSync(dir)) {
                fileNames = fs.readdirSync(dir)
                    .filter(f => f.endsWith('.sql'))
                    .sort()
                    .reverse();
            }
        }
        catch {
            // ignore
        }
        // Read local files and compute checksums
        const locals = fileNames.map(f => {
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
                syncStatus: 'new',
            };
        });
        // Fetch remote state to compare
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (url && key) {
            try {
                const [migrationsResult, prResult] = await Promise.all([
                    this.client.getMigrations(url, key, 1, 500),
                    this.client.getPullRequests(url, key),
                ]);
                this.remoteMigrations = migrationsResult.migrations || [];
                this.remotePRs = prResult.pull_requests || [];
            }
            catch {
                // offline — keep all as 'new'
            }
            // Build lookup sets for matching
            const appliedChecksums = new Set();
            const appliedNames = new Set();
            const prSqlChecksums = new Map();
            const prSqlNames = new Map();
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
                if (pr.status === 'merged') {
                    continue;
                } // already covered by migrations
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
                    const matchedMigration = this.remoteMigrations.find(m => crypto.createHash('sha256').update(m.sql_up).digest('hex') === local.checksum);
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
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.localFiles.length === 0) {
            return [new MigrationFileItem('No local migrations', '', vscode.TreeItemCollapsibleState.None, 'empty')];
        }
        return this.localFiles.map(f => {
            let desc = `${f.sizeKb} KB`;
            let status = f.syncStatus;
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
exports.MigrationsProvider = MigrationsProvider;
class MigrationFileItem extends vscode.TreeItem {
    constructor(label, description, collapsibleState, status, filePath) {
        super(label, collapsibleState);
        this.filePath = filePath;
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
exports.MigrationFileItem = MigrationFileItem;
//# sourceMappingURL=migrationsProvider.js.map