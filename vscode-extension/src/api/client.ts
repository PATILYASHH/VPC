import * as https from 'https';
import * as http from 'http';

export interface PullMigrationResult {
  migration: { filename: string; content: string } | null;
  message?: string;
  change_count?: number;
  latest_id?: number;
  has_more?: boolean;
}

export interface PullStatusResult {
  tracking_enabled: boolean;
  total_changes: number;
  cursor: number;
  pending_changes: number;
  last_pulled_at: string | null;
  project: { name: string; slug: string };
}

export interface AckResult {
  acknowledged: boolean;
  cursor: number;
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

export class PullApiClient {
  async fetchMigration(url: string, key: string): Promise<PullMigrationResult> {
    return request(`${url}/pull/migration`, {
      headers: { apikey: key },
    });
  }

  async fetchStatus(url: string, key: string): Promise<PullStatusResult> {
    return request(`${url}/pull/status`, {
      headers: { apikey: key },
    });
  }

  async ackPull(url: string, key: string, changeId: number): Promise<AckResult> {
    return request(`${url}/pull/ack`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ change_id: changeId }),
    });
  }
}
