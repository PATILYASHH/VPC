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
exports.SyncApiClient = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
function request(url, options) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const req = client.request(parsedUrl, {
            method: options.method || 'GET',
            headers: options.headers || {},
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(json.error || `HTTP ${res.statusCode}`));
                    }
                    else {
                        resolve(json);
                    }
                }
                catch {
                    reject(new Error(`Invalid response: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}
class SyncApiClient {
    getHeaders(key) {
        return { apikey: key, 'Content-Type': 'application/json' };
    }
    async getStatus(url, key) {
        return request(`${url}/sync/status`, {
            headers: { apikey: key },
        });
    }
    async getChanges(url, key, sinceId) {
        const qs = sinceId ? `?since_id=${sinceId}` : '';
        return request(`${url}/sync/changes${qs}`, {
            headers: { apikey: key },
        });
    }
    async pull(url, key) {
        return request(`${url}/sync/pull`, {
            method: 'POST',
            headers: this.getHeaders(key),
            body: '{}',
        });
    }
    async push(url, key, sql, name) {
        return request(`${url}/sync/push`, {
            method: 'POST',
            headers: this.getHeaders(key),
            body: JSON.stringify({ sql, name, title: name }),
        });
    }
    async getPullRequests(url, key, status) {
        const qs = status ? `?status=${status}` : '';
        return request(`${url}/sync/pull-requests${qs}`, {
            headers: { apikey: key },
        });
    }
    async ack(url, key, changeId) {
        return request(`${url}/sync/ack`, {
            method: 'POST',
            headers: this.getHeaders(key),
            body: JSON.stringify({ change_id: changeId }),
        });
    }
    async getMigrations(url, key, page = 1, limit = 50) {
        return request(`${url}/sync/migrations?page=${page}&limit=${limit}`, {
            headers: { apikey: key },
        });
    }
    async getSchema(url, key) {
        return request(`${url}/sync/schema`, {
            headers: { apikey: key },
        });
    }
    // ─── VPSHUB Repo Sync APIs ──────────────────────────────────
    vpshubHeaders(token) {
        return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }
    async vpshubGetManifest(baseUrl, token, owner, repo, ref) {
        return request(`${baseUrl}/admin/vpshub/repos/${owner}/${repo}/manifest/${ref}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetFileContent(baseUrl, token, owner, repo, ref, filePath) {
        return request(`${baseUrl}/admin/vpshub/repos/${owner}/${repo}/blob/${ref}/${filePath}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubDownloadFile(baseUrl, token, owner, repo, ref, filePath) {
        const url = `${baseUrl}/admin/vpshub/repos/${owner}/${repo}/raw/${ref}/${filePath}`;
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const client = parsedUrl.protocol === 'https:' ? https : http;
            client.get(parsedUrl, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            }).on('error', reject);
        });
    }
    async vpshubGetChangedFiles(baseUrl, token, owner, repo, fromSha, toSha) {
        return request(`${baseUrl}/admin/vpshub/repos/${owner}/${repo}/changes/${fromSha}/${toSha}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetBranches(baseUrl, token, owner, repo) {
        return request(`${baseUrl}/admin/vpshub/repos/${owner}/${repo}/branches`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetCommits(baseUrl, token, owner, repo, ref, limit = 30) {
        return request(`${baseUrl}/admin/vpshub/repos/${owner}/${repo}/commits/${ref}?limit=${limit}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetRepos(baseUrl, token) {
        return request(`${baseUrl}/admin/vpshub/repos`, {
            headers: this.vpshubHeaders(token),
        });
    }
    // Legacy pull endpoints (backward compat)
    async fetchMigration(url, key) {
        return request(`${url}/pull/migration`, {
            headers: { apikey: key },
        });
    }
    async fetchStatus(url, key) {
        return request(`${url}/pull/status`, {
            headers: { apikey: key },
        });
    }
    async ackPull(url, key, changeId) {
        return request(`${url}/pull/ack`, {
            method: 'POST',
            headers: this.getHeaders(key),
            body: JSON.stringify({ change_id: changeId }),
        });
    }
}
exports.SyncApiClient = SyncApiClient;
//# sourceMappingURL=client.js.map