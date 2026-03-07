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
exports.VpcOriginalContentProvider = exports.VpcQuickDiffProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Provides the "original" resource URI for Quick Diff gutter decorations.
 * Maps local .sql files to their vpc-original:// counterpart.
 */
class VpcQuickDiffProvider {
    provideOriginalResource(uri) {
        if (!uri.fsPath.endsWith('.sql')) {
            return undefined;
        }
        return vscode.Uri.parse(`vpc-original://${encodeURIComponent(uri.fsPath)}`);
    }
}
exports.VpcQuickDiffProvider = VpcQuickDiffProvider;
/**
 * Serves content for vpc-original:// URIs — returns the SQL that was
 * applied to the database, enabling diff comparison with local edits.
 */
class VpcOriginalContentProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
        this.originalContent = new Map();
    }
    updateOriginals(content) {
        this.originalContent = content;
        for (const fsPath of content.keys()) {
            this._onDidChange.fire(vscode.Uri.parse(`vpc-original://${encodeURIComponent(fsPath)}`));
        }
    }
    provideTextDocumentContent(uri) {
        const fsPath = decodeURIComponent(uri.authority + uri.path).replace(/^\/\//, '');
        // Try direct lookup and then path-only lookup
        return this.originalContent.get(fsPath)
            || this.originalContent.get(decodeURIComponent(uri.path.slice(1)))
            || '';
    }
}
exports.VpcOriginalContentProvider = VpcOriginalContentProvider;
//# sourceMappingURL=quickDiffProvider.js.map