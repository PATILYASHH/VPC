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
exports.ChangeItem = exports.ChangesProvider = void 0;
const vscode = __importStar(require("vscode"));
class ChangesProvider {
    constructor(client) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.changes = [];
        this.client = client;
    }
    refresh() {
        this.loadChanges();
    }
    async loadChanges() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (!url || !key) {
            this.changes = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        try {
            const result = await this.client.getChanges(url, key);
            this.changes = result.changes;
        }
        catch {
            this.changes = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.changes.length === 0) {
            return [new ChangeItem('No pending changes', '', '', vscode.TreeItemCollapsibleState.None, true)];
        }
        return this.changes.map(c => {
            const icon = this.getIconForType(c.event_type, c.object_type);
            const label = `${c.event_type} ${c.object_type || ''}`.trim();
            const desc = c.object_identity?.split('.').pop() || '';
            return new ChangeItem(label, desc, c.ddl_command, vscode.TreeItemCollapsibleState.None, false, icon);
        });
    }
    getPendingCount() {
        return this.changes.length;
    }
    getIconForType(eventType, objectType) {
        const type = (objectType || '').toLowerCase();
        if (type.includes('table')) {
            return new vscode.ThemeIcon('symbol-class');
        }
        if (type.includes('index')) {
            return new vscode.ThemeIcon('symbol-key');
        }
        if (type.includes('function') || type.includes('procedure')) {
            return new vscode.ThemeIcon('symbol-method');
        }
        if (type.includes('view')) {
            return new vscode.ThemeIcon('symbol-interface');
        }
        if (type.includes('trigger')) {
            return new vscode.ThemeIcon('zap');
        }
        if (type.includes('sequence')) {
            return new vscode.ThemeIcon('symbol-number');
        }
        const event = eventType.toUpperCase();
        if (event === 'DROP') {
            return new vscode.ThemeIcon('trash');
        }
        if (event.includes('ALTER')) {
            return new vscode.ThemeIcon('edit');
        }
        return new vscode.ThemeIcon('add');
    }
}
exports.ChangesProvider = ChangesProvider;
class ChangeItem extends vscode.TreeItem {
    constructor(label, description, sql, collapsibleState, isEmpty = false, icon) {
        super(label, collapsibleState);
        this.sql = sql;
        this.description = description;
        if (isEmpty) {
            this.iconPath = new vscode.ThemeIcon('check');
            this.contextValue = 'empty';
        }
        else {
            this.iconPath = icon || new vscode.ThemeIcon('circle-filled');
            this.contextValue = 'change';
            this.tooltip = sql.substring(0, 500);
            this.command = {
                command: 'vpcSync.showSQL',
                title: 'Show SQL',
                arguments: [sql],
            };
        }
    }
}
exports.ChangeItem = ChangeItem;
//# sourceMappingURL=changesProvider.js.map