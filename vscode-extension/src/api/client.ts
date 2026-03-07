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
