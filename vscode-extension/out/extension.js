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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const pull_1 = require("./commands/pull");
const configure_1 = require("./commands/configure");
const statusBar_1 = require("./views/statusBar");
const client_1 = require("./api/client");
let statusBar;
function activate(context) {
    const client = new client_1.PullApiClient();
    statusBar = new statusBar_1.StatusBarManager(client);
    context.subscriptions.push(vscode.commands.registerCommand('vpcPull.configure', () => (0, configure_1.configureCommand)()), vscode.commands.registerCommand('vpcPull.pull', () => (0, pull_1.pullCommand)(client)), vscode.commands.registerCommand('vpcPull.status', () => statusBar.showStatus()), vscode.commands.registerCommand('vpcPull.selectFolder', () => selectOutputFolder()), statusBar.getStatusBarItem());
    // Auto-refresh status bar
    const intervalSec = vscode.workspace.getConfiguration('vpcPull').get('autoRefreshInterval') || 60;
    if (intervalSec > 0) {
        const interval = setInterval(() => statusBar.refresh(), intervalSec * 1000);
        context.subscriptions.push({ dispose: () => clearInterval(interval) });
    }
    // Initial refresh
    statusBar.refresh();
}
async function selectOutputFolder() {
    const uri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Select Migration Output Folder',
    });
    if (uri && uri[0]) {
        const config = vscode.workspace.getConfiguration('vpcPull');
        const relativePath = vscode.workspace.asRelativePath(uri[0]);
        await config.update('outputFolder', relativePath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Output folder set to: ${relativePath}`);
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map