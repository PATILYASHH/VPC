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
exports.IssuesProvider = void 0;
const vscode = __importStar(require("vscode"));
class IssuesProvider {
    constructor(client) {
        this.client = client;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element) {
            return [];
        }
        const config = vscode.workspace.getConfiguration('vpcSync');
        const url = config.get('vpshubUrl');
        const token = config.get('vpshubToken');
        const owner = config.get('vpshubOwner');
        const repo = config.get('vpshubRepo');
        if (!url || !token || !owner || !repo) {
            return [];
        }
        try {
            const { issues } = await this.client.vpshubListIssues(url, token, owner, repo);
            return issues.map(issue => new IssueItem(issue));
        }
        catch {
            return [];
        }
    }
}
exports.IssuesProvider = IssuesProvider;
class IssueItem extends vscode.TreeItem {
    constructor(issue) {
        super(`#${issue.issue_number} ${issue.title}`, vscode.TreeItemCollapsibleState.None);
        this.issue = issue;
        const isOpen = issue.status === 'open';
        this.iconPath = new vscode.ThemeIcon(isOpen ? 'circle-filled' : 'pass-filled', new vscode.ThemeColor(isOpen ? 'charts.green' : 'charts.purple'));
        this.description = `${issue.author_username} · ${issue.status}`;
        this.tooltip = new vscode.MarkdownString(`**#${issue.issue_number}: ${issue.title}**\n\n` +
            `Status: ${issue.status}\n\n` +
            `Author: ${issue.author_username}\n\n` +
            `Created: ${issue.created_at}\n\n` +
            (issue.body ? `---\n\n${issue.body.substring(0, 200)}` : ''));
        this.command = {
            command: 'vpcSync.viewIssue',
            title: 'View Issue',
            arguments: [issue.issue_number],
        };
        this.contextValue = isOpen ? 'openIssue' : 'closedIssue';
    }
}
//# sourceMappingURL=issuesProvider.js.map