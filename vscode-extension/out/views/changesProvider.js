"use strict";
/**
 * Changes Provider — Push/Pull/Commit summary webview
 */
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
exports.ChangesProvider = void 0;
const vscode = __importStar(require("vscode"));
const objects = __importStar(require("../vcs/objects"));
const refs = __importStar(require("../vcs/refs"));
const sync = __importStar(require("../vcs/sync"));
class ChangesProvider {
    constructor(client, context) {
        this.client = client;
        this.context = context;
    }
    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this.updateView();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'push') {
                vscode.commands.executeCommand('vpcSync.push');
            }
            else if (msg.command === 'pull') {
                vscode.commands.executeCommand('vpcSync.pull');
            }
            else if (msg.command === 'refresh') {
                vscode.commands.executeCommand('vpcSync.refresh');
            }
        });
    }
    refresh() { this.updateView(); }
    updateView() {
        if (!this._view) {
            return;
        }
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || !objects.hasVpcRepo(root)) {
            this._view.webview.html = this.getNotConnectedHtml();
            return;
        }
        const branch = refs.getCurrentBranch(root) || 'main';
        const headHash = refs.resolveRef(root, 'HEAD');
        const status = sync.getSyncStatus(root);
        let commitCount = 0;
        if (headHash) {
            const visited = new Set();
            const queue = [headHash];
            while (queue.length > 0 && visited.size < 1000) {
                const h = queue.shift();
                if (visited.has(h)) {
                    continue;
                }
                visited.add(h);
                try {
                    const c = objects.readCommit(root, h);
                    for (const p of c.parents) {
                        queue.push(p);
                    }
                }
                catch {
                    break;
                }
            }
            commitCount = visited.size;
        }
        this._view.webview.html = this.getHtml(branch, status.ahead, status.behind, commitCount, headHash?.slice(0, 12) || '(none)');
    }
    getNotConnectedHtml() {
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px; text-align: center; }
  p { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 8px 0; }
  button { padding: 8px 16px; font-size: 12px; border: none; border-radius: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
</style></head><body>
<p>Not connected to a repository.</p>
<button onclick="vscode.postMessage({command:'connect'})">Connect to VPSHub</button>
<script>const vscode = acquireVsCodeApi();</script>
</body></html>`;
    }
    getHtml(branch, ahead, behind, commits, headShort) {
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 12px; }
  .header { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
  .branch { font-size: 12px; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600; }
  .badge-ahead { background: rgba(34,197,94,0.15); color: #22c55e; }
  .badge-behind { background: rgba(59,130,246,0.15); color: #3b82f6; }
  .info { font-size: 10px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  .buttons { display: flex; gap: 6px; margin-bottom: 8px; }
  button { flex: 1; padding: 8px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; }
  .btn-push { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-push:hover { background: var(--vscode-button-hoverBackground); }
  .btn-pull { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-pull:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-disabled { opacity: 0.5; cursor: default; }
  .sync-status { text-align: center; font-size: 11px; padding: 8px; border-radius: 6px; margin-top: 8px; }
  .synced { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.15); color: #22c55e; }
  .pending { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.15); color: #eab308; }
  .refresh-link { text-align: center; margin-top: 8px; }
  .refresh-link a { font-size: 10px; color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
</style></head><body>

<div class="header">
  <span class="branch">${esc(branch)}</span>
  ${ahead > 0 ? `<span class="badge badge-ahead">${ahead} &uarr;</span>` : ''}
  ${behind > 0 ? `<span class="badge badge-behind">${behind} &darr;</span>` : ''}
</div>

<div class="info">${commits} commit(s) &middot; HEAD: ${esc(headShort)}</div>

<div class="buttons">
  <button class="btn-push ${ahead === 0 ? 'btn-disabled' : ''}" onclick="vscode.postMessage({command:'push'})" ${ahead === 0 ? 'title="Nothing to push"' : ''}>
    Push ${ahead > 0 ? '(' + ahead + ')' : ''}
  </button>
  <button class="btn-pull" onclick="vscode.postMessage({command:'pull'})">
    Pull ${behind > 0 ? '(' + behind + ')' : ''}
  </button>
</div>

${ahead === 0 && behind === 0
            ? '<div class="sync-status synced">Up to date with remote</div>'
            : ahead > 0 && behind === 0
                ? `<div class="sync-status pending">${ahead} commit(s) to push</div>`
                : behind > 0 && ahead === 0
                    ? `<div class="sync-status pending">${behind} commit(s) to pull</div>`
                    : `<div class="sync-status pending">${ahead} to push, ${behind} to pull</div>`}

<div class="refresh-link"><a onclick="vscode.postMessage({command:'refresh'})">Refresh</a></div>

<script>const vscode = acquireVsCodeApi();</script>
</body></html>`;
    }
}
exports.ChangesProvider = ChangesProvider;
//# sourceMappingURL=changesProvider.js.map