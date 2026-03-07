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
class MigrationsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.files = [];
    }
    refresh() {
        this.loadFiles();
    }
    loadFiles() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            this.files = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        const dir = path.resolve(workspaceRoot, outFolder);
        try {
            if (fs.existsSync(dir)) {
                this.files = fs.readdirSync(dir)
                    .filter(f => f.endsWith('.sql'))
                    .sort()
                    .reverse(); // newest first
            }
            else {
                this.files = [];
            }
        }
        catch {
            this.files = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.files.length === 0) {
            return [new MigrationFileItem('No local migrations', '', vscode.TreeItemCollapsibleState.None, true)];
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const dir = path.resolve(workspaceRoot, outFolder);
        return this.files.map(f => {
            const filePath = path.join(dir, f);
            const stat = fs.statSync(filePath);
            const sizeKb = (stat.size / 1024).toFixed(1);
            return new MigrationFileItem(f, `${sizeKb} KB`, vscode.TreeItemCollapsibleState.None, false, filePath);
        });
    }
}
exports.MigrationsProvider = MigrationsProvider;
class MigrationFileItem extends vscode.TreeItem {
    constructor(label, description, collapsibleState, isEmpty = false, filePath) {
        super(label, collapsibleState);
        this.filePath = filePath;
        this.description = description;
        if (isEmpty) {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'empty';
        }
        else {
            this.iconPath = new vscode.ThemeIcon('file-code');
            this.contextValue = 'pendingMigration';
            this.tooltip = filePath;
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