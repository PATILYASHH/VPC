import * as https from 'https';
import * as http from 'http';

export interface SchemaChange {
  id: number;
  event_type: string;
  object_type: string;
  object_identity: string;
  ddl_command: string;
  schema_name: string;
  created_at: string;
}

export interface SyncStatusResult {
  tracking_enabled: boolean;
  total_changes: number;
  cursor: number;
  pending_changes: number;
  last_pulled_at: string | null;
  total_migrations: number;
  latest_migration: any;
  project: { name: string; slug: string };
}

export interface SyncChangesResult {
  changes: SchemaChange[];
  latest_id: number;
  has_more: boolean;
  since_id: number;
}

export interface SyncPullResult {
  migration: any;
  change_count: number;
  cursor: number;
  message?: string;
}

export interface MigrationRecord {
  id: string;
  version: number;
  name: string;
  sql_up: string;
  sql_down: string | null;
  status: string;
  applied_at: string | null;
  rolled_back_at: string | null;
  applied_by: string;
  source: string;
  created_at: string;
}

export interface MigrationsListResult {
  migrations: MigrationRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface SchemaColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  constraints: any[];
  indexes: any[];
}

export interface SchemaSnapshot {
  tables: SchemaTable[];
}

function request(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(
      parsedUrl,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

export class SyncApiClient {
  private getHeaders(key: string): Record<string, string> {
    return { apikey: key, 'Content-Type': 'application/json' };
  }

  async getStatus(url: string, key: string): Promise<SyncStatusResult> {
    return request(`${url}/sync/status`, {
      headers: { apikey: key },
    });
  }

  async getChanges(url: string, key: string, sinceId?: number): Promise<SyncChangesResult> {
    const qs = sinceId ? `?since_id=${sinceId}` : '';
    return request(`${url}/sync/changes${qs}`, {
      headers: { apikey: key },
    });
  }

  async pull(url: string, key: string): Promise<SyncPullResult> {
    return request(`${url}/sync/pull`, {
      method: 'POST',
      headers: this.getHeaders(key),
      body: '{}',
    });
  }

  async push(url: string, key: string, sql: string, name?: string): Promise<any> {
    return request(`${url}/sync/push`, {
      method: 'POST',
      headers: this.getHeaders(key),
      body: JSON.stringify({ sql, name, title: name }),
    });
  }

  async getPullRequests(url: string, key: string, status?: string): Promise<any> {
    const qs = status ? `?status=${status}` : '';
    return request(`${url}/sync/pull-requests${qs}`, {
      headers: { apikey: key },
    });
  }

  async ack(url: string, key: string, changeId: number): Promise<{ acknowledged: boolean; cursor: number }> {
    return request(`${url}/sync/ack`, {
      method: 'POST',
      headers: this.getHeaders(key),
      body: JSON.stringify({ change_id: changeId }),
    });
  }

  async getMigrations(url: string, key: string, page = 1, limit = 50): Promise<MigrationsListResult> {
    return request(`${url}/sync/migrations?page=${page}&limit=${limit}`, {
      headers: { apikey: key },
    });
  }

  async getSchema(url: string, key: string): Promise<SchemaSnapshot> {
    return request(`${url}/sync/schema`, {
      headers: { apikey: key },
    });
  }

  // ─── VPSHUB Repo Sync APIs ──────────────────────────────────

  private vpshubHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async vpshubGetManifest(baseUrl: string, token: string, owner: string, repo: string, ref: string): Promise<{
    ref: string; sha: string; files: { path: string; hash: string; size: number; mode: string }[]; total: number;
  }> {
    return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/manifest/${ref}`, {
      headers: this.vpshubHeaders(token),
    });
  }

  async vpshubGetFileContent(baseUrl: string, token: string, owner: string, repo: string, ref: string, filePath: string): Promise<{ content: string; path: string }> {
    return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/blob/${ref}/${filePath}`, {
      headers: this.vpshubHeaders(token),
    });
  }

  async vpshubDownloadFile(baseUrl: string, token: string, owner: string, repo: string, ref: string, filePath: string): Promise<Buffer> {
    const url = `${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/raw/${ref}/${filePath}`;
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      client.get(parsedUrl, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  async vpshubGetChangedFiles(baseUrl: string, token: string, owner: string, repo: string, fromSha: string, toSha: string): Promise<{
    changes: { status: string; path: string; oldPath?: string }[];
  }> {
    return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/changes/${fromSha}/${toSha}`, {
      headers: this.vpshubHeaders(token),
    });
  }

  async vpshubGetBranches(baseUrl: string, token: string, owner: string, repo: string): Promise<{ branches: string[] }> {
    return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/branches`, {
      headers: this.vpshubHeaders(token),
    });
  }

  async vpshubGetCommits(baseUrl: string, token: string, owner: string, repo: string, ref: string, limit = 30): Promise<any> {
    return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/commits/${ref}?limit=${limit}`, {
      headers: this.vpshubHeaders(token),
    });
  }

  async vpshubGetRepos(baseUrl: string, token: string): Promise<{ repos: any[] }> {
    return request(`${baseUrl}/api/admin/vpshub/repos`, {
      headers: this.vpshubHeaders(token),
    });
  }

  // ─── VPC VCS Transfer Protocol ───────────────────────────────

  private vcsBasicAuth(username: string, token: string): string {
    return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
  }

  /**
   * Fetch remote refs via VPC VCS protocol
   */
  async vcsFetchRefs(vcsUrl: string, username: string, token: string): Promise<{
    HEAD: string | null; defaultBranch: string; refs: Record<string, string>;
  }> {
    return request(`${vcsUrl}/refs`, {
      method: 'POST',
      headers: {
        Authorization: this.vcsBasicAuth(username, token),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  }

  /**
   * Push objects and update refs via VPC VCS protocol
   */
  async vcsPush(vcsUrl: string, username: string, token: string, objects: any[], refs: Record<string, string | { old: string; new: string }>): Promise<{
    ok: boolean; updated_refs: Record<string, string>; merged?: boolean; conflict?: boolean; auto_pr?: { pr_number: number; conflicts: string[] }; error?: string;
  }> {
    return request(`${vcsUrl}/push`, {
      method: 'POST',
      headers: {
        Authorization: this.vcsBasicAuth(username, token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ objects, refs }),
    });
  }

  /**
   * Pull objects from remote via VPC VCS protocol
   */
  async vcsPull(vcsUrl: string, username: string, token: string, wants: string[], haves: string[]): Promise<{
    refs: Record<string, string>; objectCount: number; objects: any[];
  }> {
    return request(`${vcsUrl}/pull`, {
      method: 'POST',
      headers: {
        Authorization: this.vcsBasicAuth(username, token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ wants, haves }),
    });
  }

  /**
   * Negotiate object transfer via VPC VCS protocol
   */
  async vcsNegotiate(vcsUrl: string, username: string, token: string, body: any): Promise<any> {
    return request(`${vcsUrl}/negotiate`, {
      method: 'POST',
      headers: {
        Authorization: this.vcsBasicAuth(username, token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  // Legacy pull endpoints (backward compat)
  async fetchMigration(url: string, key: string): Promise<any> {
    return request(`${url}/pull/migration`, {
      headers: { apikey: key },
    });
  }

  async fetchStatus(url: string, key: string): Promise<any> {
    return request(`${url}/pull/status`, {
      headers: { apikey: key },
    });
  }

  async ackPull(url: string, key: string, changeId: number): Promise<any> {
    return request(`${url}/pull/ack`, {
      method: 'POST',
      headers: this.getHeaders(key),
      body: JSON.stringify({ change_id: changeId }),
    });
  }
}
