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
exports.VpcFileDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
class VpcFileDecorationProvider {
    constructor() {
        this._onDidChangeFileDecorations = new vscode.EventEmitter();
        this.onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
        this.fileStatuses = new Map();
    }
    updateStatuses(statuses) {
        this.fileStatuses = statuses;
        this._onDidChangeFileDecorations.fire(undefined);
    }
    provideFileDecoration(uri) {
        if (!uri.fsPath.endsWith('.sql')) {
            return undefined;
        }
        const status = this.fileStatuses.get(uri.fsPath);
        if (!status) {
            return undefined;
        }
        switch (status) {
            case 'new':
                return new vscode.FileDecoration('N', 'New migration — not pushed', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
            case 'staged':
                return new vscode.FileDecoration('S', 'Staged for push', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
            case 'pushed':
                return new vscode.FileDecoration('P', 'PR in review', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
            case 'applied':
                return new vscode.FileDecoration('A', 'Applied to database', new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'));
            case 'failed':
                return new vscode.FileDecoration('F', 'Migration failed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
            default:
                return undefined;
        }
    }
}
exports.VpcFileDecorationProvider = VpcFileDecorationProvider;
//# sourceMappingURL=fileDecorationProvider.js.map