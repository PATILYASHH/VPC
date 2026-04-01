"use strict";
/**
 * Commit History Tree View
 */
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
exports.CommitHistoryProvider = void 0;
const vscode = __importStar(require("vscode"));
const objects = __importStar(require("../vcs/objects"));
const refs = __importStar(require("../vcs/refs"));
class CommitHistoryProvider {
    constructor(context) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.context = context;
    }
    refresh() { this._onDidChangeTreeData.fire(); }
    getTreeItem(element) { return element; }
    getChildren() {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || !objects.hasVpcRepo(root)) {
            return [];
        }
        const headHash = refs.resolveRef(root, 'HEAD');
        if (!headHash) {
            return [];
        }
        const commits = [];
        const visited = new Set();
        const queue = [headHash];
        const limit = 50;
        while (queue.length > 0 && commits.length < limit) {
            const hash = queue.shift();
            if (!hash || visited.has(hash)) {
                continue;
            }
            visited.add(hash);
            try {
                const commit = objects.readCommit(root, hash);
                const date = commit.authorDate
                    ? new Date(commit.authorDate * 1000).toLocaleDateString()
                    : '';
                const shortHash = commit.hash.slice(0, 10);
                const item = new CommitItem(`${commit.message}`, `${shortHash} by ${commit.authorName} on ${date}`, commit.hash);
                commits.push(item);
                for (const parent of commit.parents) {
                    if (!visited.has(parent)) {
                        queue.push(parent);
                    }
                }
            }
            catch {
                break;
            }
        }
        return commits;
    }
}
exports.CommitHistoryProvider = CommitHistoryProvider;
class CommitItem extends vscode.TreeItem {
    constructor(label, description, hash) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.tooltip = hash;
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.contextValue = 'commit';
    }
}
//# sourceMappingURL=historyProvider.js.map