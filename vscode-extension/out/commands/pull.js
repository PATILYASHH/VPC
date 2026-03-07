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
exports.pullCommand = pullCommand;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function pullCommand(client) {
    const config = vscode.workspace.getConfiguration('vpcPull');
    const url = config.get('serverUrl');
    const key = config.get('apiKey');
    const outFolder = config.get('outputFolder') || './migrations';
    if (!url || !key) {
        const action = await vscode.window.showErrorMessage('VPC Pull not configured.', 'Configure Now');
        if (action === 'Configure Now') {
            vscode.commands.executeCommand('vpcPull.configure');
        }
        return;
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'VPC Pull',
        cancellable: false,
    }, async (progress) => {
        progress.report({ message: 'Fetching schema changes...' });
        try {
            const result = await client.fetchMigration(url, key);
            if (!result.migration) {
                vscode.window.showInformationMessage('No new schema changes since last pull.');
                return;
            }
            progress.report({ message: `Writing ${result.change_count} changes...` });
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }
            const outDir = path.resolve(workspaceRoot, outFolder);
            if (!fs.existsSync(outDir)) {
                fs.mkdirSync(outDir, { recursive: true });
            }
            const filePath = path.join(outDir, result.migration.filename);
            fs.writeFileSync(filePath, result.migration.content);
            // Acknowledge the pull
            await client.ackPull(url, key, result.latest_id);
            // Open the migration file
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Pulled ${result.change_count} changes → ${result.migration.filename}`);
            if (result.has_more) {
                const again = await vscode.window.showWarningMessage('More changes available.', 'Pull Again');
                if (again === 'Pull Again') {
                    pullCommand(client);
                }
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
        }
    });
}
//# sourceMappingURL=pull.js.map