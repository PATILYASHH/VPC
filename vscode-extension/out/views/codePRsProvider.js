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
exports.CodePRsProvider = void 0;
const vscode = __importStar(require("vscode"));
class CodePRsProvider {
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
            const { pullRequests } = await this.client.vpshubListPRs(url, token, owner, repo);
            return (pullRequests || []).map(pr => new CodePRItem(pr));
        }
        catch {
            return [];
        }
    }
}
exports.CodePRsProvider = CodePRsProvider;
class CodePRItem extends vscode.TreeItem {
    constructor(pr) {
        super(`#${pr.pr_number} ${pr.title}`, vscode.TreeItemCollapsibleState.None);
        this.pr = pr;
        const iconMap = {
            open: { icon: 'git-pull-request', color: 'charts.green' },
            merged: { icon: 'git-merge', color: 'charts.purple' },
            closed: { icon: 'git-pull-request-closed', color: 'charts.red' },
        };
        const style = iconMap[pr.status] || iconMap.open;
        this.iconPath = new vscode.ThemeIcon(style.icon, new vscode.ThemeColor(style.color));
        this.description = `${pr.source_branch} → ${pr.target_branch}`;
        this.tooltip = new vscode.MarkdownString(`**PR #${pr.pr_number}: ${pr.title}**\n\n` +
            `${pr.source_branch} → ${pr.target_branch}\n\n` +
            `Status: ${pr.status} · Author: ${pr.author_username}\n\n` +
            `Created: ${pr.created_at}` +
            (pr.merged_at ? `\n\nMerged: ${pr.merged_at}` : ''));
        this.command = {
            command: 'vpcSync.viewCodePRDiff',
            title: 'View Diff',
            arguments: [pr.pr_number],
        };
        this.contextValue = pr.status === 'open' ? 'openPR' : pr.status === 'merged' ? 'mergedPR' : 'closedPR';
    }
}
//# sourceMappingURL=codePRsProvider.js.map