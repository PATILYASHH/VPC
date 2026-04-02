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
exports.selectRepoCommand = selectRepoCommand;
exports.switchBranchCommand = switchBranchCommand;
exports.cloneRepoCommand = cloneRepoCommand;
const vscode = __importStar(require("vscode"));
async function selectRepoCommand(client, onComplete) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('vpshubUrl');
    const token = config.get('vpshubToken');
    if (!url || !token) {
        vscode.window.showWarningMessage('Set vpshubUrl and vpshubToken first.');
        return;
    }
    try {
        const { repos } = await client.vpshubGetRepos(url, token);
        if (repos.length === 0) {
            vscode.window.showInformationMessage('No repositories found.');
            return;
        }
        const items = repos.map(r => ({
            label: `${r.owner_username}/${r.name}`,
            description: `${r.visibility} · ${r.description || ''}`,
            detail: [
                r.linked_project_id ? '$(database) DB' : '',
                r.linked_hosting_id ? '$(globe) Hosting' : '',
            ].filter(Boolean).join(' · ') || undefined,
            owner: r.owner_username,
            slug: r.slug,
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a repository to connect',
            matchOnDescription: true,
        });
        if (!selected) {
            return;
        }
        await config.update('vpshubOwner', selected.owner, vscode.ConfigurationTarget.Workspace);
        await config.update('vpshubRepo', selected.slug, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Connected to ${selected.label}`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to list repos: ${err.message}`);
    }
}
async function switchBranchCommand(client, onComplete) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('vpshubUrl') || '';
    const token = config.get('vpshubToken') || '';
    const owner = config.get('vpshubOwner') || '';
    const repo = config.get('vpshubRepo') || '';
    if (!url || !token || !owner || !repo) {
        vscode.window.showWarningMessage('Select a repository first.');
        return;
    }
    try {
        const { branches } = await client.vpshubGetBranches(url, token, owner, repo);
        if (branches.length === 0) {
            vscode.window.showInformationMessage('No branches found.');
            return;
        }
        const currentBranch = config.get('vpshubBranch') || 'main';
        const items = branches.map(b => ({
            label: b,
            description: b === currentBranch ? '(current)' : '',
        }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Switch branch' });
        if (!selected) {
            return;
        }
        await config.update('vpshubBranch', selected.label, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Switched to branch: ${selected.label}`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to list branches: ${err.message}`);
    }
}
async function cloneRepoCommand(client) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('vpshubUrl');
    const token = config.get('vpshubToken');
    if (!url || !token) {
        vscode.window.showWarningMessage('Set vpshubUrl and vpshubToken first.');
        return;
    }
    try {
        const { repos } = await client.vpshubGetRepos(url, token);
        if (repos.length === 0) {
            vscode.window.showInformationMessage('No repositories found.');
            return;
        }
        const items = repos.map(r => ({
            label: `${r.owner_username}/${r.name}`,
            description: r.visibility,
            cloneUrl: `${url}/git/${r.owner_username}/${r.slug}.git`,
        }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select repo to clone' });
        if (!selected) {
            return;
        }
        // Use VS Code's built-in git clone
        await vscode.commands.executeCommand('git.clone', selected.cloneUrl);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to list repos: ${err.message}`);
    }
}
//# sourceMappingURL=repoSelect.js.map