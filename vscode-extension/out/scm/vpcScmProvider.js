"use strict";
/**
 * VPC VCS SCM Provider — Git-like Source Control
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
exports.VpcScmProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const objects = __importStar(require("../vcs/objects"));
const refs = __importStar(require("../vcs/refs"));
const index = __importStar(require("../vcs/index"));
class VpcScmProvider {
    get inputBox() { return this.scm.inputBox; }
    constructor(root) {
        this.root = root;
        this.scm = vscode.scm.createSourceControl('vpc-sync', 'VPC Sync', vscode.Uri.file(root));
        this.scm.inputBox.placeholder = 'Commit message (Ctrl+Enter to commit)';
        this.scm.acceptInputCommand = { command: 'vpcSync.commit', title: 'Commit' };
        this.staged = this.scm.createResourceGroup('staged', 'Staged Changes');
        this.changes = this.scm.createResourceGroup('changes', 'Changes');
        this.untracked = this.scm.createResourceGroup('untracked', 'Untracked');
        this.staged.hideWhenEmpty = true;
        this.changes.hideWhenEmpty = true;
        this.untracked.hideWhenEmpty = true;
        this.scm.count = 0;
    }
    scheduleRefresh() {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => this.refresh(), 500);
    }
    async refresh() {
        if (!objects.hasVpcRepo(this.root)) {
            return;
        }
        try {
            const idx = index.readIndex(this.root);
            const indexMap = new Map(idx.entries.map(e => [e.path, e.hash]));
            const headHash = refs.resolveRef(this.root, 'HEAD');
            const headMap = new Map();
            if (headHash) {
                try {
                    const commit = objects.readCommit(this.root, headHash);
                    for (const f of objects.walkTree(this.root, commit.tree)) {
                        headMap.set(f.path, f.hash);
                    }
                }
                catch { /* empty repo */ }
            }
            const workspaceFiles = index.getAllWorkspaceFiles(this.root);
            const workspaceSet = new Set(workspaceFiles);
            const workHashes = new Map();
            for (const fp of workspaceFiles) {
                try {
                    workHashes.set(fp, objects.hashObject('blob', fs.readFileSync(path.resolve(this.root, fp))));
                }
                catch { /* skip */ }
            }
            const stagedItems = [];
            const changedItems = [];
            const untrackedItems = [];
            // Staged: index vs HEAD
            for (const [fp, ih] of indexMap) {
                if (headMap.get(fp) !== ih) {
                    const uri = vscode.Uri.file(path.resolve(this.root, fp));
                    const isNew = !headMap.has(fp);
                    stagedItems.push({ resourceUri: uri, decorations: { tooltip: isNew ? 'New file' : 'Modified', iconPath: new vscode.ThemeIcon(isNew ? 'diff-added' : 'diff-modified', new vscode.ThemeColor('gitDecoration.addedResourceForeground')) } });
                }
            }
            for (const [fp] of headMap) {
                if (!indexMap.has(fp)) {
                    stagedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { strikeThrough: true, tooltip: 'Deleted', iconPath: new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')) } });
                }
            }
            // Changes: workspace vs index
            for (const [fp, ih] of indexMap) {
                if (!workspaceSet.has(fp)) {
                    changedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { strikeThrough: true, tooltip: 'Deleted', iconPath: new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground')) } });
                }
                else if (workHashes.get(fp) && workHashes.get(fp) !== ih) {
                    changedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { tooltip: 'Modified', iconPath: new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')) } });
                }
            }
            // Untracked: in workspace but not in index/HEAD
            for (const fp of workspaceFiles) {
                if (!indexMap.has(fp) && !headMap.has(fp)) {
                    untrackedItems.push({ resourceUri: vscode.Uri.file(path.resolve(this.root, fp)), decorations: { tooltip: 'Untracked', iconPath: new vscode.ThemeIcon('question', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')) } });
                }
            }
            this.staged.resourceStates = stagedItems;
            this.changes.resourceStates = changedItems;
            this.untracked.resourceStates = untrackedItems;
            this.scm.count = stagedItems.length + changedItems.length;
        }
        catch (err) {
            console.error('[VPC SCM] Refresh error:', err);
        }
    }
    dispose() {
        this.scm.dispose();
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
    }
}
exports.VpcScmProvider = VpcScmProvider;
//# sourceMappingURL=vpcScmProvider.js.map