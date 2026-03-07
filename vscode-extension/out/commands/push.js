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
            placeHolder: 'Select a migration file to push',
        });
        if (!selected) {
            return;
        }
        filePath = path.join(dir, selected);
    }
    // Confirm push
    const fileName = path.basename(filePath);
    const confirm = await vscode.window.showWarningMessage(`Push "${fileName}" to remote database? This will execute the SQL.`, { modal: true }, 'Push');
    if (confirm !== 'Push') {
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'VPC Sync',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: `Pushing ${fileName}...` });
        try {
            const sql = fs.readFileSync(filePath, 'utf-8');
            const name = path.basename(filePath, '.sql');
            const result = await client.push(url, key, sql, name);
            vscode.window.showInformationMessage(`Pushed migration v${result.version} — ${result.status}`);
            onComplete?.();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Push failed: ${err.message}`);
        }
    });
}
//# sourceMappingURL=push.js.map