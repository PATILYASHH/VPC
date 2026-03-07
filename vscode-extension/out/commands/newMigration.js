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
exports.newMigrationCommand = newMigrationCommand;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function newMigrationCommand() {
    const config = vscode.workspace.getConfiguration('vpcSync');
    const outFolder = config.get('outputFolder') || './migrations';
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: 'Migration name',
        placeHolder: 'add_users_table',
        validateInput: (value) => {
            if (!value || !/^[a-z0-9_]+$/i.test(value)) {
                return 'Use letters, numbers, and underscores only';
            }
            return null;
        },
    });
    if (!name) {
        return;
    }
    const dir = path.resolve(workspaceRoot, outFolder);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `${timestamp}_${name.toLowerCase()}.sql`;
    const filePath = path.join(dir, filename);
    const template = [
        `-- Migration: ${name}`,
        `-- Created: ${new Date().toISOString()}`,
        '',
        '-- Write your SQL migration here:',
        '',
        '',
    ].join('\n');
    fs.writeFileSync(filePath, template);
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Created migration: ${filename}`);
}
//# sourceMappingURL=newMigration.js.map