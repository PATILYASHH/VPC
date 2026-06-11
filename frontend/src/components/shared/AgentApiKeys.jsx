import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Key, Shield, CheckCircle2, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

// Agent API key manager — VPC Bot keys (agent with tools) and Claude CLI keys
// (direct Claude access). Used by AgentSettings (API Access tab) and ApiKeyManager.

const AGENT_PERM_OPTIONS = [
  { key: 'view', label: 'View', desc: 'Read-only — health, logs, files, project listings' },
  { key: 'edit', label: 'Edit', desc: 'Write files, run scripts, deploys, PM2, todos' },
  { key: 'delete', label: 'Delete', desc: 'Destructive — DELETE/DROP SQL, remove commands' },
  { key: 'repositories', label: 'Repositories', desc: 'Git operations and deployments' },
  { key: 'database', label: 'Database', desc: 'Run SQL, DB health, create databases' },
  { key: 'claude', label: 'Claude AI', desc: 'Direct Claude (CLI) access via /ask — raw prompts, no tools' },
];

const EMPTY_PERMS = { view: true, edit: false, delete: false, repositories: false, database: false, claude: false };

export default function AgentApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('bot');
  const [newPerms, setNewPerms] = useState({ ...EMPTY_PERMS });
  const [newStoreHistory, setNewStoreHistory] = useState(false);
  const [newExpireDays, setNewExpireDays] = useState('');
  const [createdKey, setCreatedKey] = useState(null);

  function load() {
    setLoading(true);
    api.get('/admin/settings/ai-agent/api-keys')
      .then(({ data }) => setKeys(data.keys || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const expires_at = newExpireDays
        ? new Date(Date.now() + Number(newExpireDays) * 86400000).toISOString()
        : null;
      const { data } = await api.post('/admin/settings/ai-agent/api-keys', {
        name: newName.trim(),
        key_type: newType,
        permissions: newPerms,
        store_history: newStoreHistory,
        expires_at,
      });
      setCreatedKey(data);
      setNewName('');
      setNewPerms({ ...EMPTY_PERMS });
      setNewStoreHistory(false);
      setNewExpireDays('');
      toast.success('API key generated');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to generate key'); }
    finally { setCreating(false); }
  }

  async function handleUpdate(id, patch) {
    try {
      await api.put(`/admin/settings/ai-agent/api-keys/${id}`, patch);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to update'); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this API key permanently? Clients using it will lose access.')) return;
    try {
      await api.delete(`/admin/settings/ai-agent/api-keys/${id}`);
      toast.success('API key deleted');
      load();
    } catch { toast.error('Failed to delete'); }
  }

  function copyKey(text) {
    navigator.clipboard.writeText(text).then(() => toast.success('Copied to clipboard'));
  }

  const baseUrl = window.location.origin;

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-xs text-muted-foreground">
        Generate API keys to chat with the Bot remotely — including your Claude CLI subscription — from scripts,
        apps, or other machines. Each key controls exactly which data it can touch, and whether its chats are
        stored in VPC history or stay untracked.
      </p>

      {/* New key reveal — shown only once */}
      {createdKey && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">Key generated — copy it now, it won&apos;t be shown again</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono px-3 py-2.5 rounded-lg select-all break-all" style={{ background: 'rgba(0,0,0,0.3)' }}>
              {createdKey.api_key}
            </code>
            <Button size="sm" variant="outline" onClick={() => copyKey(createdKey.api_key)} className="h-9 shrink-0">
              <Copy className="w-3.5 h-3.5 mr-1" />Copy
            </Button>
          </div>
          <button onClick={() => setCreatedKey(null)} className="text-[10px] text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Create form */}
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground/60" />
          <span className="text-xs font-semibold">Generate New Key</span>
        </div>

        {/* Key type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {[
            { id: 'bot', label: 'VPC Bot', desc: 'Full agent — chat with tools, gated by data allowance below' },
            { id: 'claude', label: 'Claude CLI', desc: 'Direct Claude access only (/ask) — your subscription as an API, no bot, no tools' },
          ].map(t => (
            <label key={t.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
              newType === t.id ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-white/[0.02]'
            }`}>
              <input
                type="radio"
                name="agent-key-type"
                checked={newType === t.id}
                onChange={() => setNewType(t.id)}
                className="mt-0.5"
              />
              <span>
                <span className="text-xs font-medium block">{t.label}</span>
                <span className="text-[10px] text-muted-foreground/60">{t.desc}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Key name (e.g. laptop-remote, telegram-script)..."
            className="flex-1 h-9 text-xs"
          />
          <select
            value={newExpireDays}
            onChange={e => setNewExpireDays(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-2 text-xs w-28"
          >
            <option value="">Never expires</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>

        {/* Data allowance — bot keys only */}
        <div className={newType === 'claude' ? 'hidden' : ''}>
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="w-3.5 h-3.5 text-muted-foreground/50" />
            <span className="text-[11px] font-medium text-muted-foreground">Data allowance — what this key can access</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {AGENT_PERM_OPTIONS.map(opt => (
              <label key={opt.key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                newPerms[opt.key] ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-white/[0.02]'
              }`}>
                <input
                  type="checkbox"
                  checked={newPerms[opt.key]}
                  onChange={e => setNewPerms(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                  className="mt-0.5 rounded border-border"
                />
                <span>
                  <span className="text-xs font-medium block">{opt.label}</span>
                  <span className="text-[10px] text-muted-foreground/60">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* History tracking — bot keys only (Claude CLI /ask calls are never stored) */}
        {newType === 'claude' && (
          <p className="text-[10px] text-muted-foreground/60 rounded-lg border border-border px-3 py-2">
            Claude CLI keys are always untracked — prompts and responses are never stored in VPC history.
          </p>
        )}
        <label className={`${newType === 'claude' ? 'hidden' : ''} flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
          newStoreHistory ? 'border-amber-500/30 bg-amber-500/5' : 'border-border'
        }`}>
          <input
            type="checkbox"
            checked={newStoreHistory}
            onChange={e => setNewStoreHistory(e.target.checked)}
            className="mt-0.5 rounded border-border"
          />
          <span>
            <span className="text-xs font-medium block">Store chats in VPC history</span>
            <span className="text-[10px] text-muted-foreground/60">
              Off (default): API chats stay untracked — nothing is saved to conversation history.
              On: chats via this key are stored like normal bot conversations.
            </span>
          </span>
        </label>

        <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || creating} className="h-8 text-xs">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
          Generate API Key
        </Button>
      </div>

      {/* Key list */}
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : keys.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          <Key className="w-8 h-8 mx-auto mb-2 opacity-30" />No API keys yet
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className={`rounded-xl border px-4 py-3 ${k.is_active ? '' : 'opacity-50'}`} style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-0)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{k.name}</span>
                <code className="text-[10px] font-mono text-muted-foreground/60">{k.key_prefix}...</code>
                <Badge variant="outline" className={`text-[9px] ${k.key_type === 'claude' ? 'text-amber-400 border-amber-500/30' : 'text-violet-400 border-violet-500/30'}`}>
                  {k.key_type === 'claude' ? 'Claude CLI' : 'VPC Bot'}
                </Badge>
                {!k.is_active && <Badge variant="outline" className="text-[9px] text-red-400 border-red-500/30">revoked</Badge>}
                <Badge variant="outline" className={`text-[9px] ${k.store_history ? 'text-amber-400 border-amber-500/30' : 'text-emerald-400 border-emerald-500/30'}`}>
                  {k.store_history ? 'tracked' : 'untracked'}
                </Badge>
                <div className="ml-auto flex items-center gap-1">
                  {k.key_type !== 'claude' && (
                  <Button variant="ghost" size="sm" onClick={() => handleUpdate(k.id, { store_history: !k.store_history })}
                    className="h-7 text-[10px] px-2" title="Toggle history tracking">
                    {k.store_history ? 'Untrack' : 'Track'}
                  </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleUpdate(k.id, { is_active: !k.is_active })}
                    className="h-7 text-[10px] px-2" title={k.is_active ? 'Revoke' : 'Re-enable'}>
                    {k.is_active ? 'Revoke' : 'Enable'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(k.id)} className="h-7 w-7 p-0">
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                  </Button>
                </div>
              </div>
              {k.key_type !== 'claude' && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {AGENT_PERM_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" title={opt.desc}>
                    <input
                      type="checkbox"
                      checked={k.permissions?.[opt.key] === true}
                      onChange={e => handleUpdate(k.id, { permissions: { ...k.permissions, [opt.key]: e.target.checked } })}
                      className="rounded border-border"
                    />
                    <span className={k.permissions?.[opt.key] ? 'text-foreground' : 'text-muted-foreground/50'}>{opt.label}</span>
                  </label>
                ))}
              </div>
              )}
              <div className="flex gap-3 mt-1.5 text-[9px] text-muted-foreground/40">
                <span>{k.total_requests || 0} requests</span>
                {k.last_used_at && <span>Last used: {new Date(k.last_used_at).toLocaleString()}</span>}
                {k.expires_at && <span>Expires: {new Date(k.expires_at).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Usage guide */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-blue-400">How to use</p>
        <p>Chat with the Bot (tools gated by key permissions):</p>
        <code className="block text-[10px] font-mono px-3 py-2 rounded-lg whitespace-pre-wrap break-all" style={{ background: 'rgba(0,0,0,0.3)' }}>
{`curl -X POST ${baseUrl}/api/agent/v1/chat \\
  -H "x-api-key: vpcbot_..." -H "Content-Type: application/json" \\
  -d '{"message": "show server health"}'`}
        </code>
        <p>Direct Claude prompt (no tools, never stored — Claude CLI keys or bot keys with the Claude AI permission):</p>
        <code className="block text-[10px] font-mono px-3 py-2 rounded-lg whitespace-pre-wrap break-all" style={{ background: 'rgba(0,0,0,0.3)' }}>
{`curl -X POST ${baseUrl}/api/agent/v1/ask \\
  -H "x-api-key: vpccli_..." -H "Content-Type: application/json" \\
  -d '{"prompt": "explain this error: ..."}'`}
        </code>
        <p className="text-[10px] text-muted-foreground/60">
          For untracked keys, pass <code>history: [{'{'}role, content{'}'}]</code> in the chat body to keep
          multi-turn context — the server won&apos;t remember previous messages for you.
        </p>
      </div>
    </div>
  );
}
