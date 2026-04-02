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
exports.createCodePRCommand = createCodePRCommand;
exports.mergePRCommand = mergePRCommand;
exports.viewPRDiffCommand = viewPRDiffCommand;
exports.commentOnPRCommand = commentOnPRCommand;
const vscode = __importStar(require("vscode"));
function getVpshubConfig() {
    const config = vscode.workspace.getConfiguration('vpcSync');
    return {
        url: config.get('vpshubUrl') || '',
        token: config.get('vpshubToken') || '',
        owner: config.get('vpshubOwner') || '',
        repo: config.get('vpshubRepo') || '',
    };
}
async function createCodePRCommand(client, onComplete) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        vscode.window.showWarningMessage('VPSHub not configured.');
        return;
    }
    // Get branches
    let branches = [];
    try {
        const result = await client.vpshubGetBranches(url, token, owner, repo);
        branches = result.branches || [];
    }
    catch {
        vscode.window.showErrorMessage('Failed to fetch branches.');
        return;
    }
    if (branches.length < 2) {
        vscode.window.showWarningMessage('Need at least 2 branches to create a PR.');
        return;
    }
    const sourceBranch = await vscode.window.showQuickPick(branches, { placeHolder: 'Source branch (your changes)' });
    if (!sourceBranch) {
        return;
    }
    const targetBranch = await vscode.window.showQuickPick(branches.filter(b => b !== sourceBranch), { placeHolder: 'Target branch (merge into)' });
    if (!targetBranch) {
        return;
    }
    const title = await vscode.window.showInputBox({ prompt: 'PR title', placeHolder: 'What does this PR do?' });
    if (!title) {
        return;
    }
    const description = await vscode.window.showInputBox({ prompt: 'PR description (optional)' });
    try {
        const result = await client.vpshubCreatePR(url, token, owner, repo, title, description || '', sourceBranch, targetBranch);
        vscode.window.showInformationMessage(`PR #${result.pr.pr_number} created: ${sourceBranch} → ${targetBranch}`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to create PR: ${err.message}`);
    }
}
async function mergePRCommand(client, onComplete, prNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    if (!prNumber) {
        const input = await vscode.window.showInputBox({ prompt: 'PR number to merge' });
        if (!input) {
            return;
        }
        prNumber = parseInt(input, 10);
    }
    const confirm = await vscode.window.showWarningMessage(`Merge PR #${prNumber}?`, { modal: true }, 'Merge');
    if (confirm !== 'Merge') {
        return;
    }
    try {
        await client.vpshubMergePR(url, token, owner, repo, prNumber);
        vscode.window.showInformationMessage(`PR #${prNumber} merged successfully!`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
    }
}
async function viewPRDiffCommand(client, prNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    try {
        const data = await client.vpshubGetPRDiff(url, token, owner, repo, prNumber);
        const doc = await vscode.workspace.openTextDocument({ content: data.diff || 'No changes', language: 'diff' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to load diff: ${err.message}`);
    }
}
async function commentOnPRCommand(client, onComplete, prNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    if (!prNumber) {
        const input = await vscode.window.showInputBox({ prompt: 'PR number' });
        if (!input) {
            return;
        }
        prNumber = parseInt(input, 10);
    }
    const body = await vscode.window.showInputBox({ prompt: 'Your comment' });
    if (!body) {
        return;
    }
    try {
        await client.vpshubCommentOnPR(url, token, owner, repo, prNumber, body);
        vscode.window.showInformationMessage(`Comment added to PR #${prNumber}.`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to comment: ${err.message}`);
    }
}
//# sourceMappingURL=codePR.js.map