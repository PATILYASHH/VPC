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
exports.pushCommand = pushCommand;
exports.pushAllCommand = pushAllCommand;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function pushCommand(client, onComplete, filePath) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        const action = await vscode.window.showErrorMessage('VPC Sync not configured.', 'Configure Now');
        if (action === 'Configure Now') {
            vscode.commands.executeCommand('vpcSync.configure');
        }
        return;
    }
    // If no file path provided, let user pick a .sql file
    if (!filePath) {
        const outFolder = config.get('outputFolder') || './migrations';
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }
        const dir = path.resolve(workspaceRoot, outFolder);
        if (!fs.existsSync(dir)) {
            vscode.window.showWarningMessage('No migrations folder found.');
            return;
        }
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
        if (files.length === 0) {
            vscode.window.showWarningMessage('No SQL migration files found.');
            return;
        }
        const selected = await vscode.window.showQuickPick(files, {
            placeHolder: 'Select a migration file to push as Pull Request',
        });
        if (!selected) {
            return;
        }
        filePath = path.join(dir, selected);
    }
    const fileName = path.basename(filePath);
    const confirm = await vscode.window.showWarningMessage(`Create pull request for "${fileName}"? This submits for review in VPSHub, not direct apply.`, { modal: true }, 'Create PR');
    if (confirm !== 'Create PR') {
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'VPC Sync',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: `Creating pull request...` });
        try {
            const sql = fs.readFileSync(filePath, 'utf-8');
            const name = path.basename(filePath, '.sql');
            const result = await client.push(url, key, sql, name);
            if (result.pull_request) {
                vscode.window.showInformationMessage(`PR #${result.pull_request.pr_number} created: "${result.pull_request.title}". Review and merge in VPSHub.`);
            }
            else {
                vscode.window.showInformationMessage(result.message || 'Push completed');
            }
            onComplete?.();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Push failed: ${err.message}`);
        }
    });
}
/**
 * Push all staged migrations as PRs. Uses the SCM input box text as PR title.
 */
async function pushAllCommand(client, scmProvider, onComplete) {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    if (!url || !key) {
        vscode.window.showErrorMessage('VPC Sync not configured.');
        return;
    }
    const staged = scmProvider.getStagedFiles();
    if (staged.length === 0) {
        vscode.window.showWarningMessage('No migrations staged for push. Stage files first using the + button.');
        return;
    }
    const title = scmProvider.getInputBoxValue().trim();
    if (!title) {
        vscode.window.showWarningMessage('Enter a PR title in the input box above the file list.');
        return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'VPC Sync', cancellable: false }, async (progress) => {
        let pushed = 0;
        for (const file of staged) {
            const prTitle = staged.length === 1 ? title : `${title} — ${file.name}`;
            progress.report({ message: `Pushing ${file.name} (${++pushed}/${staged.length})...` });
            try {
                const result = await client.push(url, key, file.sql, prTitle);
                if (result.pull_request) {
                    vscode.window.showInformationMessage(`PR #${result.pull_request.pr_number} created: "${result.pull_request.title}"`);
                }
            }
            catch (err) {
                vscode.window.showErrorMessage(`Push failed for ${file.name}: ${err.message}`);
                return;
            }
        }
        scmProvider.clearInputBox();
        scmProvider.clearStaged();
        vscode.window.showInformationMessage(`Pushed ${staged.length} migration(s) as PR(s).`);
        onComplete?.();
    });
}
//# sourceMappingURL=push.js.map