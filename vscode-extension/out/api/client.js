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
function request(url, options, retries = 2) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        const req = client.request(parsedUrl, {
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 60000, // 60s timeout
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode && res.statusCode >= 400) {
                        const errMsg = json.error || json.message || `Server error (HTTP ${res.statusCode})`;
                        reject(new Error(errMsg));
                    }
                    else {
                        resolve(json);
                    }
                }
                catch {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`Server error (HTTP ${res.statusCode})`));
                    }
                    else {
                        reject(new Error(`Invalid response from server`));
                    }
                }
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection timed out. Check your server URL and network.'));
        });
        req.on('error', (err) => {
            if (retries > 0 && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT')) {
                // Retry after a short delay
                setTimeout(() => {
                    request(url, options, retries - 1).then(resolve).catch(reject);
                }, 1000);
            }
            else {
                const friendly = err.code === 'ECONNREFUSED'
                    ? 'Cannot connect to server. Is it running?'
                    : err.code === 'ENOTFOUND'
                        ? 'Server not found. Check the URL.'
                        : err.message;
                reject(new Error(friendly));
            }
        });
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
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/manifest/${ref}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetFileContent(baseUrl, token, owner, repo, ref, filePath) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/blob/${ref}/${filePath}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubDownloadFile(baseUrl, token, owner, repo, ref, filePath) {
        const url = `${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/raw/${ref}/${filePath}`;
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
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/changes/${fromSha}/${toSha}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetBranches(baseUrl, token, owner, repo) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/branches`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetCommits(baseUrl, token, owner, repo, ref, limit = 30) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/commits/${ref}?limit=${limit}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetRepos(baseUrl, token) {
        return request(`${baseUrl}/api/admin/vpshub/repos`, {
            headers: this.vpshubHeaders(token),
        });
    }
    // ─── VPC VCS Transfer Protocol ───────────────────────────────
    vcsBasicAuth(username, token) {
        return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
    }
    /**
     * Fetch remote refs via VPC VCS protocol
     */
    async vcsFetchRefs(vcsUrl, username, token) {
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
    async vcsPush(vcsUrl, username, token, objects, refs) {
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
    async vcsPull(vcsUrl, username, token, wants, haves) {
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
    async vcsNegotiate(vcsUrl, username, token, body) {
        return request(`${vcsUrl}/negotiate`, {
            method: 'POST',
            headers: {
                Authorization: this.vcsBasicAuth(username, token),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }
    // ─── VPSHub PR APIs (Admin API) ──────────────────────────────
    async vpshubCreatePR(baseUrl, token, owner, repo, title, description, sourceBranch, targetBranch) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls`, {
            method: 'POST',
            headers: this.vpshubHeaders(token),
            body: JSON.stringify({ title, description, source_branch: sourceBranch, target_branch: targetBranch }),
        });
    }
    async vpshubGetPRs(baseUrl, token, owner, repo, status) {
        const qs = status ? `?status=${status}` : '';
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls${qs}`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubGetPRDiff(baseUrl, token, owner, repo, prNumber) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/diff`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubMergePR(baseUrl, token, owner, repo, prNumber) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
            method: 'POST',
            headers: this.vpshubHeaders(token),
            body: '{}',
        });
    }
    async vpshubCheckMerge(baseUrl, token, owner, repo, prNumber) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/merge-check`, {
            headers: this.vpshubHeaders(token),
        });
    }
    async vpshubCommentOnPR(baseUrl, token, owner, repo, prNumber, body) {
        return request(`${baseUrl}/api/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
            method: 'POST',
            headers: this.vpshubHeaders(token),
            body: JSON.stringify({ body }),
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