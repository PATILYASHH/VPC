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
exports.HistoryItem = exports.HistoryProvider = void 0;
const vscode = __importStar(require("vscode"));
class HistoryProvider {
    constructor(client) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.migrations = [];
        this.client = client;
    }
    refresh() {
        this.loadHistory();
    }
    async loadHistory() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (!url || !key) {
            this.migrations = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        try {
            const result = await this.client.getMigrations(url, key);
            this.migrations = result.migrations;
        }
        catch {
            this.migrations = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.migrations.length === 0) {
            return [new HistoryItem('No migration history', '', vscode.TreeItemCollapsibleState.None, true)];
        }
        return this.migrations.map(m => {
            const icon = this.getStatusIcon(m.status);
            const date = m.applied_at || m.created_at;
            const dateStr = new Date(date).toLocaleDateString();
            const desc = `${m.status} - ${dateStr}`;
            return new HistoryItem(`v${m.version} ${m.name || ''}`.trim(), desc, vscode.TreeItemCollapsibleState.None, false, icon, m);
        });
    }
    getStatusIcon(status) {
        switch (status) {
            case 'applied': return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
            case 'pending': return new vscode.ThemeIcon('circle-outline');
            case 'rolled_back': return new vscode.ThemeIcon('debug-reverse-continue', new vscode.ThemeColor('testing.iconSkipped'));
            case 'failed': return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            default: return new vscode.ThemeIcon('circle-outline');
        }
    }
}
exports.HistoryProvider = HistoryProvider;
class HistoryItem extends vscode.TreeItem {
    constructor(label, description, collapsibleState, isEmpty = false, icon, migration) {
        super(label, collapsibleState);
        this.migration = migration;
        this.description = description;
        if (isEmpty) {
            this.iconPath = new vscode.ThemeIcon('history');
            this.contextValue = 'empty';
        }
        else {
            this.iconPath = icon || new vscode.ThemeIcon('circle-outline');
            this.contextValue = 'historyItem';
            if (migration) {
                this.tooltip = `Status: ${migration.status}\nSource: ${migration.source}\nApplied by: ${migration.applied_by || '-'}`;
                this.command = {
                    command: 'vpcSync.showSQL',
                    title: 'Show SQL',
                    arguments: [migration.sql_up],
                };
            }
        }
    }
}
exports.HistoryItem = HistoryItem;
//# sourceMappingURL=historyProvider.js.map