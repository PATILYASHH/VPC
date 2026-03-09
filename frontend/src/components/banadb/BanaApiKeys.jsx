import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Copy, Eye, EyeOff, RefreshCw, Globe, Key, Shield, AlertTriangle,
  Code2, Check,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

export default function BanaApiKeys({ project }) {
  const [showAnon, setShowAnon] = useState(false);
  const [showService, setShowService] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [activeTab, setActiveTab] = useState('javascript');
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['bana-api-keys', project.id],
    `${baseUrl}/api-keys`
  );

  const keys = data?.keys || [];
  const anonKey = keys.find((k) => k.role === 'anon' && k.is_active);
  const serviceKey = keys.find((k) => k.role === 'service' && k.is_active);

  const apiUrl = `${window.location.origin}/api/bana/v1/${project.slug}`;

  const copyText = copyToClipboard;

  const handleRegenerate = async (role) => {
    const label = role === 'service' ? 'service_role' : 'anon';
    if (!confirm(`Regenerate ${label} key? Current key will stop working immediately.`)) return;
    setRegenerating(role);
    try {
      await api.post(`${baseUrl}/api-keys/regenerate`, { role });
      queryClient.invalidateQueries({ queryKey: ['bana-api-keys'] });
      toast.success(`${label} key regenerated`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to regenerate');
    } finally {
      setRegenerating(null);
    }
  };

  const maskKey = (key) => {
    if (!key) return '••••••••••••••••••••••••••••••••••••••••';
    const prefixEnd = key.indexOf('_', 5) + 1;
    return key.slice(0, prefixEnd) + key.slice(prefixEnd, prefixEnd + 4) + '••••••••••••••••••••••••••••';
  };

  if (isLoading) return <LoadingSpinner />;

  const anonKeyStr = anonKey?.api_key || 'YOUR_ANON_KEY';
  const serviceKeyStr = serviceKey?.api_key || 'YOUR_SERVICE_KEY';

  return (
    <div className="h-full overflow-auto p-4 space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold">API</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect to your DB project using these credentials.
        </p>
      </div>

      {/* ── Connection Details ─────────────────────────────── */}
      <div className="border rounded-lg divide-y">
        {/* Project URL */}
        <KeyRow
          icon={<Globe className="w-3.5 h-3.5 text-muted-foreground" />}
          label="Project URL"
          value={apiUrl}
          onCopy={() => copyText(apiUrl)}
        />

        {/* Anon Key */}
        <KeyRow
          icon={<Key className="w-3.5 h-3.5 text-blue-400" />}
          label="anon key"
          badge={<Badge variant="secondary" className="text-[9px] ml-1.5">public</Badge>}
          value={showAnon ? anonKeyStr : maskKey(anonKey?.api_key)}
          onCopy={() => copyText(anonKeyStr)}
          onToggle={() => setShowAnon(!showAnon)}
          showToggle
          isRevealed={showAnon}
          onRegenerate={() => handleRegenerate('anon')}
          regenerating={regenerating === 'anon'}
          isLegacy={anonKey && !anonKey.api_key}
        />

        {/* Service Key */}
        <KeyRow
          icon={<Shield className="w-3.5 h-3.5 text-amber-400" />}
          label="service_role key"
          badge={<Badge variant="destructive" className="text-[9px] ml-1.5">secret</Badge>}
          value={showService ? serviceKeyStr : maskKey(serviceKey?.api_key)}
          onCopy={() => copyText(serviceKeyStr)}
          onToggle={() => setShowService(!showService)}
          showToggle
          isRevealed={showService}
          onRegenerate={() => handleRegenerate('service')}
          regenerating={regenerating === 'service'}
          isLegacy={serviceKey && !serviceKey.api_key}
        />
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2 text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          The <strong>anon key</strong> is safe for browsers — reads are open, writes need user login.
          The <strong>service_role key</strong> has full access — only use in server-side code, never expose to clients.
        </span>
      </div>

      {/* ── Getting Started ──────────────────────────────── */}
      <div className="border rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b">
          <Code2 className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-medium">Getting Started</h3>
        </div>

        {/* Language tabs */}
        <div className="flex border-b">
          {['javascript', 'curl', 'python'].map((tab) => (
            <button
              key={tab}
              className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'javascript' ? 'JavaScript' : tab === 'curl' ? 'cURL' : 'Python'}
            </button>
          ))}
        </div>

        <div className="p-3 space-y-4">
          {activeTab === 'javascript' && (
            <>
              <CodeBlock title="Initialize" copyFn={copyText} code={`const BANA_URL = "${apiUrl}"
const BANA_KEY = "${anonKeyStr.slice(0, 20)}..."

async function bana(path, opts = {}) {
  const res = await fetch(BANA_URL + path, {
    ...opts,
    headers: { "apikey": BANA_KEY, "Content-Type": "application/json", ...opts.headers }
  })
  return res.json()
}`} />
              <CodeBlock title="Read rows" copyFn={copyText} code={`// All rows
const data = await bana("/rest/customers")

// With filters
const data = await bana("/rest/customers?is_active=eq.true&limit=10")

// Filter operators: eq, neq, gt, gte, lt, lte, like, ilike
const data = await bana("/rest/customers?name=ilike.*john*")

// Sort & paginate
const data = await bana("/rest/orders?order=-created_at&limit=20&offset=0")`} />
              <CodeBlock title="Auth — signup & login" copyFn={copyText} code={`// Signup
const { user, access_token } = await bana("/auth/signup", {
  method: "POST",
  body: JSON.stringify({ email: "user@email.com", password: "password123" })
})

// Login
const { user, access_token } = await bana("/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: "user@email.com", password: "password123" })
})`} />
              <CodeBlock title="Write rows (anon key + user token)" copyFn={copyText} code={`// Insert
await bana("/rest/orders", {
  method: "POST",
  headers: { Authorization: "Bearer " + access_token },
  body: JSON.stringify({ customer_id: 1, total: 250.00 })
})

// Update
await bana("/rest/orders?id=eq.42", {
  method: "PATCH",
  headers: { Authorization: "Bearer " + access_token },
  body: JSON.stringify({ status: "shipped" })
})

// Delete
await bana("/rest/orders?id=eq.42", {
  method: "DELETE",
  headers: { Authorization: "Bearer " + access_token }
})`} />
              <CodeBlock title="Service key — full access (server only)" copyFn={copyText} code={`// No auth needed — direct write
await fetch("${apiUrl}/rest/orders", {
  method: "POST",
  headers: { "apikey": SERVICE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ customer_id: 1, total: 250.00 })
})

// Execute raw SQL
await fetch("${apiUrl}/sql", {
  method: "POST",
  headers: { "apikey": SERVICE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ sql: "SELECT count(*) FROM orders" })
})`} />
            </>
          )}

          {activeTab === 'curl' && (
            <>
              <CodeBlock title="Read rows" copyFn={copyText} code={`curl ${apiUrl}/rest/customers \\
  -H "apikey: ${anonKeyStr.slice(0, 20)}..."

# With filters
curl "${apiUrl}/rest/customers?is_active=eq.true&limit=5" \\
  -H "apikey: YOUR_ANON_KEY"`} />
              <CodeBlock title="Login" copyFn={copyText} code={`curl -X POST ${apiUrl}/auth/login \\
  -H "apikey: YOUR_ANON_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@email.com","password":"password123"}'`} />
              <CodeBlock title="Insert row" copyFn={copyText} code={`curl -X POST ${apiUrl}/rest/orders \\
  -H "apikey: YOUR_ANON_KEY" \\
  -H "Authorization: Bearer ACCESS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"customer_id":1,"total":250.00}'`} />
              <CodeBlock title="Execute SQL (service key)" copyFn={copyText} code={`curl -X POST ${apiUrl}/sql \\
  -H "apikey: YOUR_SERVICE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"sql":"SELECT * FROM customers LIMIT 5"}'`} />
            </>
          )}

          {activeTab === 'python' && (
            <>
              <CodeBlock title="Initialize" copyFn={copyText} code={`import requests

BANA_URL = "${apiUrl}"
BANA_KEY = "${anonKeyStr.slice(0, 20)}..."
headers = {"apikey": BANA_KEY, "Content-Type": "application/json"}`} />
              <CodeBlock title="Read rows" copyFn={copyText} code={`# All rows
data = requests.get(f"{BANA_URL}/rest/customers", headers=headers).json()

# With filters
data = requests.get(
    f"{BANA_URL}/rest/customers?is_active=eq.true&limit=10",
    headers=headers
).json()`} />
              <CodeBlock title="Auth & write" copyFn={copyText} code={`# Login
res = requests.post(f"{BANA_URL}/auth/login", headers=headers,
    json={"email": "user@email.com", "password": "password123"})
token = res.json()["access_token"]

# Insert (with user token)
auth_headers = {**headers, "Authorization": f"Bearer {token}"}
requests.post(f"{BANA_URL}/rest/orders", headers=auth_headers,
    json={"customer_id": 1, "total": 250.00})`} />
              <CodeBlock title="Service key — SQL (server only)" copyFn={copyText} code={`svc_headers = {"apikey": "YOUR_SERVICE_KEY", "Content-Type": "application/json"}
res = requests.post(f"{BANA_URL}/sql", headers=svc_headers,
    json={"sql": "SELECT count(*) FROM orders"})
print(res.json())`} />
            </>
          )}
        </div>
      </div>

      {/* ── Permissions ──────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium">Permissions</h3>
        <div className="text-[10px]">
          <table className="w-full">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Endpoint</th>
                <th className="text-center py-1.5 font-medium w-24">anon</th>
                <th className="text-center py-1.5 font-medium w-24">service_role</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ['GET /rest/*', true, true],
                ['POST /rest/*', 'bearer', true],
                ['PATCH /rest/*', 'bearer', true],
                ['DELETE /rest/*', 'bearer', true],
                ['POST /auth/signup', true, true],
                ['POST /auth/login', true, true],
                ['POST /sql', false, true],
              ].map(([endpoint, anon, service], i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 font-mono">{endpoint}</td>
                  <td className="text-center">
                    {anon === true ? <Check className="w-3 h-3 text-green-500 mx-auto" /> :
                     anon === 'bearer' ? <span className="text-amber-400">+ Bearer</span> :
                     <span className="text-destructive">—</span>}
                  </td>
                  <td className="text-center">
                    {service ? <Check className="w-3 h-3 text-green-500 mx-auto" /> :
                     <span className="text-destructive">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Key row in connection details card ──────────────────────────
function KeyRow({ icon, label, badge, value, onCopy, onToggle, showToggle, isRevealed, onRegenerate, regenerating, isLegacy }) {
  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {icon}
          <span className="text-[11px] font-medium ml-1.5">{label}</span>
          {badge}
        </div>
        {onRegenerate && (
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${regenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={isLegacy ? `${value}... (regenerate to reveal)` : value}
          readOnly
          className="font-mono text-[11px] h-7 bg-muted/30"
        />
        {showToggle && !isLegacy && (
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onToggle}>
            {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCopy}>
          <Copy className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Code block with copy button ─────────────────────────────────
function CodeBlock({ title, code, copyFn }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground mb-1">{title}</p>
      <div className="relative group">
        <pre className="text-[10px] bg-muted/40 rounded p-2.5 overflow-x-auto font-mono leading-relaxed whitespace-pre text-muted-foreground">{code}</pre>
        <button
          className="absolute top-1.5 right-1.5 p-1 rounded bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => copyFn(code)}
        >
          <Copy className="w-2.5 h-2.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
