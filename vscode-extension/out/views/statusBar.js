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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
class StatusBarManager {
    constructor(client) {
        this.client = client;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'vpcPull.pull';
        this.item.tooltip = 'VPC Pull: Click to pull schema changes';
    }
    getStatusBarItem() {
        return this.item;
    }
    async refresh() {
        const config = vscode.workspace.getConfiguration('vpcPull');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (!url || !key) {
            this.item.hide();
            return;
        }
        try {
            const status = await this.client.fetchStatus(url, key);
            const pending = status.pending_changes || 0;
            if (pending > 0) {
                this.item.text = `$(cloud-download) VPC: ${pending} pending`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
            else {
                this.item.text = `$(check) VPC: up to date`;
                this.item.backgroundColor = undefined;
            }
            this.item.show();
        }
        catch {
            this.item.text = `$(warning) VPC: offline`;
            this.item.backgroundColor = undefined;
            this.item.show();
        }
    }
    async showStatus() {
        const config = vscode.workspace.getConfiguration('vpcPull');
        const url = config.get('serverUrl');
        const key = config.get('apiKey');
        if (!url || !key) {
            vscode.window.showWarningMessage('VPC Pull not configured. Run "VPC Pull: Configure Connection" first.');
            return;
        }
        try {
            const status = await this.client.fetchStatus(url, key);
            const lines = [
                `Project: ${status.project.name} (${status.project.slug})`,
                `Tracking: ${status.tracking_enabled ? 'enabled' : 'disabled'}`,
                `Total changes: ${status.total_changes}`,
                `Pending: ${status.pending_changes}`,
                `Last pulled: ${status.last_pulled_at ? new Date(status.last_pulled_at).toLocaleString() : 'never'}`,
            ];
            vscode.window.showInformationMessage(lines.join(' | '));
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to fetch status: ${err.message}`);
        }
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBar.js.map