/**
 * VPC AuthenticationProvider — GitHub-style device-flow sign-in.
 *
 * Registers as a first-class VS Code auth provider so the sidebar shows
 * "Sign in to VPC" in the Accounts menu, and the session (PAT + username +
 * server URL) is stored in the OS keychain via context.secrets.
 */

import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

const AUTH_PROVIDER_ID = 'vpc';
const AUTH_PROVIDER_LABEL = 'VPC';
const SESSION_KEY = 'vpc.session';

export interface VpcSession extends vscode.AuthenticationSession {
  readonly serverUrl: string;
  readonly username: string;
}

interface StoredSession {
  id: string;
  accessToken: string;
  username: string;
  serverUrl: string;
  email?: string;
  displayName?: string;
}

function postJson(url: string, body: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, data: chunks ? JSON.parse(chunks) : {} }); }
        catch { resolve({ status: res.statusCode || 0, data: { error: chunks } }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.write(JSON.stringify(body || {}));
    req.end();
  });
}

export class VpcAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this._onDidChangeSessions.event;

  constructor(private ctx: vscode.ExtensionContext) {}

  dispose() { this._onDidChangeSessions.dispose(); }

  private async readStored(): Promise<StoredSession | undefined> {
    const raw = await this.ctx.secrets.get(SESSION_KEY);
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  private async writeStored(s: StoredSession | undefined): Promise<void> {
    if (!s) { await this.ctx.secrets.delete(SESSION_KEY); }
    else { await this.ctx.secrets.store(SESSION_KEY, JSON.stringify(s)); }
  }

  async getSessions(): Promise<VpcSession[]> {
    const s = await this.readStored();
    if (!s) return [];
    return [toSession(s)];
  }

  async createSession(): Promise<VpcSession> {
    // Ask for server URL (sticky — default from previous session or config)
    const prev = await this.readStored();
    const defaultUrl = prev?.serverUrl
      || vscode.workspace.getConfiguration('vpcSync').get<string>('serverUrl')
      || 'http://localhost:8001';

    const serverUrl = await vscode.window.showInputBox({
      prompt: 'VPC server URL',
      value: defaultUrl,
      placeHolder: 'http://your-server:8001',
      ignoreFocusOut: true,
      validateInput: v => {
        try { new URL(v.trim()); return null; } catch { return 'Enter a valid URL'; }
      },
    });
    if (!serverUrl) throw new Error('Sign-in cancelled');

    const base = serverUrl.trim().replace(/\/+$/, '');

    // 1. Request device code
    const { status, data } = await postJson(`${base}/api/admin/auth/device/code`, {
      client_name: 'VS Code · VPC Sync',
    });
    if (status !== 200) {
      throw new Error(data?.error || `Server returned HTTP ${status}`);
    }

    const { device_code, user_code, verification_uri_complete, expires_in, interval } = data;

    // 2. Open browser + show code to user (copy-pasteable)
    const copied = await vscode.window.showInformationMessage(
      `Your device code is ${user_code}. A browser will open for approval.`,
      { modal: false },
      'Open Browser', 'Copy Code'
    );
    if (copied === 'Copy Code') {
      await vscode.env.clipboard.writeText(user_code);
    }
    vscode.env.openExternal(vscode.Uri.parse(verification_uri_complete));

    // 3. Poll for token
    const session = await vscode.window.withProgress<StoredSession>({
      location: vscode.ProgressLocation.Notification,
      title: `Waiting for approval... Code: ${user_code}`,
      cancellable: true,
    }, async (progress, cancel) => {
      const deadline = Date.now() + (expires_in * 1000);
      while (Date.now() < deadline) {
        if (cancel.isCancellationRequested) throw new Error('Sign-in cancelled');

        await new Promise(r => setTimeout(r, (interval || 3) * 1000));
        if (cancel.isCancellationRequested) throw new Error('Sign-in cancelled');

        const pollResp = await postJson(`${base}/api/admin/auth/device/token`, { device_code });

        if (pollResp.status === 200) {
          return {
            id: `vpc:${pollResp.data.username}@${base}`,
            accessToken: pollResp.data.access_token,
            username: pollResp.data.username,
            serverUrl: pollResp.data.server_url || base,
            email: pollResp.data.email,
            displayName: pollResp.data.display_name,
          };
        }

        if (pollResp.status === 202) continue;       // still pending
        if (pollResp.status === 410) throw new Error('Device code expired. Please sign in again.');
        if (pollResp.status === 403) throw new Error('Authorization was denied.');
        throw new Error(pollResp.data?.error || `Poll failed (HTTP ${pollResp.status})`);
      }
      throw new Error('Device code expired');
    });

    await this.writeStored(session);
    const vsSession = toSession(session);
    this._onDidChangeSessions.fire({ added: [vsSession], removed: [], changed: [] });
    return vsSession;
  }

  async removeSession(sessionId: string): Promise<void> {
    const s = await this.readStored();
    if (!s || s.id !== sessionId) return;
    await this.writeStored(undefined);
    this._onDidChangeSessions.fire({ added: [], removed: [toSession(s)], changed: [] });
  }
}

function toSession(s: StoredSession): VpcSession {
  return {
    id: s.id,
    accessToken: s.accessToken,
    account: { id: s.username, label: s.displayName || s.username },
    scopes: ['repo', 'sync'],
    serverUrl: s.serverUrl,
    username: s.username,
  };
}

export function registerVpcAuth(ctx: vscode.ExtensionContext): VpcAuthProvider {
  const provider = new VpcAuthProvider(ctx);
  ctx.subscriptions.push(
    vscode.authentication.registerAuthenticationProvider(AUTH_PROVIDER_ID, AUTH_PROVIDER_LABEL, provider, {
      supportsMultipleAccounts: false,
    }),
    provider,
  );
  return provider;
}

export async function getVpcSession(createIfNone: boolean = false): Promise<VpcSession | undefined> {
  const s = await vscode.authentication.getSession(AUTH_PROVIDER_ID, ['repo', 'sync'], {
    createIfNone,
  });
  return s as VpcSession | undefined;
}

export async function signOut(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.secrets.delete(SESSION_KEY);
}

export const VPC_AUTH_PROVIDER_ID = AUTH_PROVIDER_ID;
