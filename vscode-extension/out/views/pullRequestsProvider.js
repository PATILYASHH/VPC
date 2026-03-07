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
exports.PRItem = exports.PullRequestsProvider = void 0;
const vscode = __importStar(require("vscode"));
class PullRequestsProvider {
    constructor(client) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.prs = [];
        this.client = client;
    }
    refresh() {
        this.loadPRs();
    }
    async loadPRs() {
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (!url || !key) {
            this.prs = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }
        try {
            const result = await this.client.getPullRequests(url, key);
            this.prs = result.pull_requests || [];
        }
        catch {
            this.prs = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        if (this.prs.length === 0) {
            return [new PRItem('No pull requests', '', vscode.TreeItemCollapsibleState.None, true)];
        }
        return this.prs.map(pr => {
            const icon = this.getStatusIcon(pr.status);
            const desc = `${pr.status} · ${pr.submitted_by}`;
            return new PRItem(`#${pr.pr_number} ${pr.title}`, desc, vscode.TreeItemCollapsibleState.None, false, icon, pr);
        });
    }
    getStatusIcon(status) {
        switch (status) {
            case 'open': return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('testing.iconPassed'));
            case 'merged': return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
            case 'closed': return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('testing.iconFailed'));
            case 'conflict': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
            case 'testing': return new vscode.ThemeIcon('loading~spin');
            default: return new vscode.ThemeIcon('git-pull-request');
        }
    }
}
exports.PullRequestsProvider = PullRequestsProvider;
class PRItem extends vscode.TreeItem {
    constructor(label, description, collapsibleState, isEmpty = false, icon, pr) {
        super(label, collapsibleState);
        this.pr = pr;
        this.description = description;
        if (isEmpty) {
            this.iconPath = new vscode.ThemeIcon('git-pull-request');
            this.contextValue = 'empty';
        }
        else {
            this.iconPath = icon || new vscode.ThemeIcon('git-pull-request');
            this.contextValue = 'pullRequest';
            if (pr) {
                this.tooltip = `#${pr.pr_number} ${pr.title}\nStatus: ${pr.status}\nBy: ${pr.submitted_by}\n${new Date(pr.created_at).toLocaleString()}`;
                this.command = {
                    command: 'vpcSync.showSQL',
                    title: 'Show SQL',
                    arguments: [pr.sql_content],
                };
            }
        }
    }
}
exports.PRItem = PRItem;
//# sourceMappingURL=pullRequestsProvider.js.map