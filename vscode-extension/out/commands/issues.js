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
exports.createIssueCommand = createIssueCommand;
exports.closeIssueCommand = closeIssueCommand;
exports.commentOnIssueCommand = commentOnIssueCommand;
exports.viewIssueCommand = viewIssueCommand;
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
async function createIssueCommand(client, onComplete) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        vscode.window.showWarningMessage('VPSHub not configured. Set vpshubUrl, vpshubToken, vpshubOwner, and vpshubRepo.');
        return;
    }
    const title = await vscode.window.showInputBox({ prompt: 'Issue title', placeHolder: 'Describe the issue...' });
    if (!title) {
        return;
    }
    const body = await vscode.window.showInputBox({ prompt: 'Issue description (optional)', placeHolder: 'Additional details...' });
    try {
        const result = await client.vpshubCreateIssue(url, token, owner, repo, title, body || '');
        vscode.window.showInformationMessage(`Issue #${result.issue.issue_number} created: ${title}`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to create issue: ${err.message}`);
    }
}
async function closeIssueCommand(client, onComplete, issueNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    if (!issueNumber) {
        const input = await vscode.window.showInputBox({ prompt: 'Issue number to close' });
        if (!input) {
            return;
        }
        issueNumber = parseInt(input, 10);
    }
    try {
        await client.vpshubCloseIssue(url, token, owner, repo, issueNumber);
        vscode.window.showInformationMessage(`Issue #${issueNumber} closed.`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to close issue: ${err.message}`);
    }
}
async function commentOnIssueCommand(client, onComplete, issueNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    if (!issueNumber) {
        const input = await vscode.window.showInputBox({ prompt: 'Issue number' });
        if (!input) {
            return;
        }
        issueNumber = parseInt(input, 10);
    }
    const body = await vscode.window.showInputBox({ prompt: 'Your comment' });
    if (!body) {
        return;
    }
    try {
        await client.vpshubCommentOnIssue(url, token, owner, repo, issueNumber, body);
        vscode.window.showInformationMessage(`Comment added to issue #${issueNumber}.`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to comment: ${err.message}`);
    }
}
async function viewIssueCommand(client, issueNumber) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    try {
        const data = await client.vpshubGetIssue(url, token, owner, repo, issueNumber);
        const issue = data.issue;
        const comments = data.comments || [];
        const lines = [
            `# Issue #${issue.issue_number}: ${issue.title}`,
            `Status: ${issue.status} | Author: ${issue.author_username} | Created: ${issue.created_at}`,
            '',
            issue.body || '(No description)',
            '',
            `--- Comments (${comments.length}) ---`,
            '',
        ];
        for (const c of comments) {
            lines.push(`[${c.author_username}] ${c.created_at}`);
            lines.push(c.body);
            lines.push('');
        }
        const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to load issue: ${err.message}`);
    }
}
//# sourceMappingURL=issues.js.map