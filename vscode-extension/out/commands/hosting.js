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
exports.deployCommand = deployCommand;
exports.hostingControlCommand = hostingControlCommand;
exports.viewHostingLogsCommand = viewHostingLogsCommand;
exports.hostingStatusCommand = hostingStatusCommand;
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
async function deployCommand(client, onComplete) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        vscode.window.showWarningMessage('VPSHub not configured.');
        return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Deploying...', cancellable: false }, async () => {
        try {
            const result = await client.vpshubDeployHosting(url, token, owner, repo);
            vscode.window.showInformationMessage(result.message || 'Deploy successful!');
            onComplete();
        }
        catch (err) {
            vscode.window.showErrorMessage(`Deploy failed: ${err.message}`);
        }
    });
}
async function hostingControlCommand(client, onComplete, action) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    if (!action) {
        action = await vscode.window.showQuickPick(['start', 'stop', 'restart'], { placeHolder: 'Select action' }) || undefined;
        if (!action) {
            return;
        }
    }
    try {
        const result = await client.vpshubHostingControl(url, token, owner, repo, action);
        vscode.window.showInformationMessage(result.message || `${action} successful!`);
        onComplete();
    }
    catch (err) {
        vscode.window.showErrorMessage(`${action} failed: ${err.message}`);
    }
}
async function viewHostingLogsCommand(client) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        return;
    }
    try {
        const data = await client.vpshubGetHostingLogs(url, token, owner, repo);
        const doc = await vscode.workspace.openTextDocument({ content: data.logs || 'No logs available', language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: true });
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to fetch logs: ${err.message}`);
    }
}
async function hostingStatusCommand(client) {
    const { url, token, owner, repo } = getVpshubConfig();
    if (!url || !token || !owner || !repo) {
        vscode.window.showWarningMessage('VPSHub not configured.');
        return;
    }
    try {
        const data = await client.vpshubGetHostingStatus(url, token, owner, repo);
        if (!data.hosting) {
            vscode.window.showInformationMessage('No hosting linked to this repository.');
            return;
        }
        const h = data.hosting;
        const s = data.status;
        vscode.window.showInformationMessage(`Hosting: ${h.name} | Type: ${h.type} | Status: ${s?.status || 'unknown'}${s?.uptime ? ` | Uptime: ${s.uptime}` : ''}${s?.memory ? ` | RAM: ${s.memory}` : ''}`);
    }
    catch (err) {
        vscode.window.showErrorMessage(`Failed to get status: ${err.message}`);
    }
}
//# sourceMappingURL=hosting.js.map