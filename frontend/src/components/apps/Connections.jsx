import { useEffect, useMemo, useState } from 'react';
import {
  Plug, Plus, Star, Search, Trash2, RefreshCw, Edit3, X, Check,
  CheckCircle2, AlertCircle, Loader2, Github, Gitlab, Database, Box, Shield, MessageSquare,
  Mail, Link as LinkIcon, Cloud, Triangle, Sparkles, CreditCard, Notebook, Bug,
  Send, Phone, Flame, Leaf, Terminal, Webhook, Zap, Train, Minus,
} from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import useIntegrationsStore from '@/stores/useIntegrationsStore';
import { notify } from '@/stores/useNotificationStore';

const ICON_MAP = {
  github: Github, gitlab: Gitlab, bitbucket: Gitlab,
  supabase: Database, firebase: Flame, mongodb: Leaf,
  planetscale: Database, neon: Database, redis: Database,
  docker: Box, vercel: Triangle, netlify: Triangle, railway: Train, render: Cloud,
  aws: Cloud, gcp: Cloud, digitalocean: Cloud, cloudflare: Shield,
  s3: Box,
  slack: MessageSquare, discord: MessageSquare, telegram: Send, teams: MessageSquare,
  smtp: Mail, sendgrid: Mail, twilio: Phone,
  openai: Sparkles, anthropic: Sparkles, google_ai: Sparkles, groq: Sparkles,
  stripe: CreditCard, razorpay: CreditCard,
  notion: Notebook, linear: Minus, jira: Bug,
  webhook: Webhook, ssh: Terminal,
};

const TYPE_ACCENT = {
  github: 'text-violet-300 bg-violet-500/10',
  gitlab: 'text-orange-300 bg-orange-500/10',
  bitbucket: 'text-blue-300 bg-blue-500/10',
  supabase: 'text-emerald-300 bg-emerald-500/10',
  firebase: 'text-amber-300 bg-amber-500/10',
  mongodb: 'text-green-300 bg-green-500/10',
  planetscale: 'text-fuchsia-300 bg-fuchsia-500/10',
  neon: 'text-cyan-300 bg-cyan-500/10',
  redis: 'text-rose-300 bg-rose-500/10',
  docker: 'text-sky-300 bg-sky-500/10',
  vercel: 'text-white bg-white/10',
  netlify: 'text-teal-300 bg-teal-500/10',
  railway: 'text-violet-300 bg-violet-500/10',
  render: 'text-purple-300 bg-purple-500/10',
  aws: 'text-orange-400 bg-orange-500/10',
  gcp: 'text-blue-400 bg-blue-500/10',
  digitalocean: 'text-blue-300 bg-blue-500/10',
  cloudflare: 'text-orange-300 bg-orange-500/10',
  s3: 'text-orange-300 bg-orange-500/10',
  slack: 'text-pink-300 bg-pink-500/10',
  discord: 'text-indigo-300 bg-indigo-500/10',
  telegram: 'text-sky-300 bg-sky-500/10',
  teams: 'text-violet-300 bg-violet-500/10',
  smtp: 'text-amber-300 bg-amber-500/10',
  sendgrid: 'text-blue-300 bg-blue-500/10',
  twilio: 'text-red-300 bg-red-500/10',
  openai: 'text-emerald-300 bg-emerald-500/10',
  anthropic: 'text-orange-300 bg-orange-500/10',
  google_ai: 'text-blue-300 bg-blue-500/10',
  groq: 'text-rose-300 bg-rose-500/10',
  stripe: 'text-indigo-300 bg-indigo-500/10',
  razorpay: 'text-blue-300 bg-blue-500/10',
  notion: 'text-white bg-white/10',
  linear: 'text-violet-300 bg-violet-500/10',
  jira: 'text-blue-400 bg-blue-500/10',
  webhook: 'text-amber-300 bg-amber-500/10',
  ssh: 'text-green-300 bg-green-500/10',
};

export default function Connections() {
  const list = useIntegrationsStore((s) => s.list);
  const types = useIntegrationsStore((s) => s.types);
  const refresh = useIntegrationsStore((s) => s.refresh);
  const setDefault = useIntegrationsStore((s) => s.setDefault);
  const remove = useIntegrationsStore((s) => s.remove);
  const test = useIntegrationsStore((s) => s.test);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [adding, setAdding] = useState(null);
  const [editing, setEditing] = useState(null);
  const [usesById, setUsesById] = useState({});
  const [testingId, setTestingId] = useState(null);
  const [runningAutomation, setRunningAutomation] = useState(null);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    api.get('/admin/integrations/uses/all').then(({ data }) => {
      const grouped = {};
      for (const u of data.uses || []) {
        if (!grouped[u.integration_id]) grouped[u.integration_id] = [];
        grouped[u.integration_id].push(u);
      }
      setUsesById(grouped);
    }).catch(() => {});
  }, [list]);

  const categories = useMemo(() => {
    const set = new Set(['All']);
    Object.values(types).forEach((t) => t.category && set.add(t.category));
    return Array.from(set);
  }, [types]);

  const catalogFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.entries(types).filter(([id, t]) => {
      if (activeCategory !== 'All' && t.category !== activeCategory) return false;
      if (!q) return true;
      return (
        id.includes(q) ||
        t.name?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q)
      );
    });
  }, [types, search, activeCategory]);

  const connectedCount = list.length;

  const handleTest = async (id) => {
    setTestingId(id);
    try {
      const res = await test(id);
      notify({
        title: res.ok ? 'Connection successful' : 'Connection failed',
        message: res.ok ? `${res.latency}ms` : (res.error || 'Test failed'),
        category: 'system',
        level: res.ok ? 'success' : 'error',
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Disconnect "${name}"? Apps that use it will need a new connection.`)) return;
    await remove(id);
    notify({ title: 'Integration removed', message: name, category: 'system', level: 'info' });
  };

  const handleSetDefault = async (id, name) => {
    await setDefault(id);
    notify({ title: 'Set as default', message: name, category: 'system', level: 'success' });
  };

  const runAutomation = async (integration, automationId, label) => {
    setRunningAutomation(`${integration.id}:${automationId}`);
    try {
      const { data } = await api.post(`/admin/integrations/${integration.id}/automate`, { automation: automationId });
      notify({
        title: `${label} ✓`,
        message: data.message || `Ran automation on ${integration.name}`,
        category: 'system',
        level: 'success',
      });
    } catch (err) {
      notify({
        title: `${label} failed`,
        message: err.response?.data?.error || err.message,
        category: 'error',
        level: 'error',
      });
    } finally {
      setRunningAutomation(null);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Toolbar */}
      <div className="h-11 px-3 flex items-center gap-2 border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
        <Plug className="w-4 h-4 opacity-70" />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Connections</span>
        <span className="text-[10px] opacity-50">
          · {connectedCount} saved · {Object.keys(types).length} platforms
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border w-64" style={{ borderColor: 'var(--surface-border)' }}>
          <Search className="w-3 h-3 opacity-50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search platforms…"
            className="flex-1 bg-transparent border-0 outline-none text-[11px] placeholder:opacity-40"
            style={{ color: 'var(--text-on-surface)' }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left: catalog */}
        <div className="col-span-4 lg:col-span-3 border-r overflow-y-auto" style={{ borderColor: 'var(--surface-border)' }}>
          {/* Category tabs */}
          <div className="sticky top-0 z-10 px-2 py-2 border-b backdrop-blur-md" style={{ background: 'var(--surface-0)', borderColor: 'var(--surface-border)' }}>
            <div className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCategory(c)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    activeCategory === c
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06]'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Platform list */}
          <div className="p-2">
            {catalogFiltered.length === 0 ? (
              <div className="text-center py-8 text-xs opacity-40">No platforms match</div>
            ) : (
              catalogFiltered.map(([typeId, t]) => {
                const Icon = ICON_MAP[typeId] || LinkIcon;
                const connectedOfType = list.filter((i) => i.type === typeId).length;
                return (
                  <button
                    key={typeId}
                    onClick={() => setAdding(typeId)}
                    className="w-full flex items-center gap-2 px-2 h-10 rounded-md hover:bg-white/[0.04] text-left group"
                  >
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center ${TYPE_ACCENT[typeId] || 'bg-white/[0.05]'}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-on-surface)' }}>{t.name}</div>
                        {connectedOfType > 0 && (
                          <span className="text-[9px] px-1 py-0 rounded bg-emerald-500/15 text-emerald-400">{connectedOfType}</span>
                        )}
                      </div>
                      <div className="text-[9px] opacity-40 truncate">{t.category}</div>
                    </div>
                    <Plus className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: connected list */}
        <div className="col-span-8 lg:col-span-9 overflow-y-auto p-3">
          {list.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-50 gap-2">
              <Plug className="w-8 h-8" />
              <div className="text-sm">No connections yet</div>
              <div className="text-[11px]">Pick a platform on the left to connect</div>
            </div>
          ) : (
            <ConnectedGroups
              list={list}
              types={types}
              usesById={usesById}
              testingId={testingId}
              runningAutomation={runningAutomation}
              onTest={handleTest}
              onEdit={setEditing}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              onAutomate={runAutomation}
            />
          )}
        </div>
      </div>

      {(adding || editing) && (
        <ConnectModal
          typeId={adding || editing?.type}
          typeMeta={types[adding || editing?.type]}
          existing={editing}
          onClose={() => { setAdding(null); setEditing(null); }}
          onSaved={() => { setAdding(null); setEditing(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Connected groups ───────────────────────────────────────

function ConnectedGroups({ list, types, usesById, testingId, runningAutomation, onTest, onEdit, onDelete, onSetDefault, onAutomate }) {
  const groupedByCategory = useMemo(() => {
    const g = {};
    for (const i of list) {
      const cat = types[i.type]?.category || 'Other';
      if (!g[cat]) g[cat] = {};
      if (!g[cat][i.type]) g[cat][i.type] = [];
      g[cat][i.type].push(i);
    }
    return g;
  }, [list, types]);

  return Object.entries(groupedByCategory).map(([category, types_]) => (
    <div key={category} className="mb-6">
      <div className="text-[10px] font-semibold uppercase tracking-widest opacity-50 mb-2 px-1">{category}</div>
      {Object.entries(types_).map(([type, items]) => {
        const Icon = ICON_MAP[type] || LinkIcon;
        const meta = types[type];
        return (
          <div key={type} className="mb-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Icon className="w-3.5 h-3.5 opacity-70" />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-on-surface)' }}>{meta?.name || type}</span>
              <span className="text-[10px] opacity-40">· {items.length}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {items.map((i) => (
                <IntegrationCard
                  key={i.id}
                  integration={i}
                  type={type}
                  Icon={Icon}
                  typeMeta={meta}
                  uses={usesById[i.id] || []}
                  testing={testingId === i.id}
                  runningAutomation={runningAutomation}
                  onTest={onTest}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onSetDefault={onSetDefault}
                  onAutomate={onAutomate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  ));
}

function IntegrationCard({ integration: i, type, Icon, typeMeta, uses, testing, runningAutomation, onTest, onEdit, onDelete, onSetDefault, onAutomate }) {
  const automations = typeMeta?.automations || [];

  return (
    <div
      className="rounded-xl border p-3 hover:bg-white/[0.02] transition-colors"
      style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${TYPE_ACCENT[type] || 'bg-white/[0.05]'}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>{i.name}</span>
            {i.is_default && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
            {i.status === 'connected' ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : i.status === 'error' ? (
              <AlertCircle className="w-3 h-3 text-rose-400" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
            )}
          </div>
          <div className="text-[10px] opacity-50 mt-0.5 truncate">
            {i.metadata?.login && `@${i.metadata.login} · `}
            {i.metadata?.username && !i.metadata?.login && `${i.metadata.username} · `}
            {i.metadata?.email && `${i.metadata.email} · `}
            {i.last_checked_at ? `checked ${format(new Date(i.last_checked_at), 'MMM d, HH:mm')}` : 'never tested'}
          </div>
          {uses.length > 0 && (
            <div className="text-[10px] opacity-60 mt-1.5">
              Used by: {uses.map((u) => u.app_id).join(', ')}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-2.5 flex-wrap">
        <button
          onClick={() => onTest(i.id)}
          disabled={testing}
          className="h-6 px-2 rounded text-[10px] hover:bg-white/[0.06] flex items-center gap-1 opacity-70 hover:opacity-100"
        >
          {testing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
          Test
        </button>
        {!i.is_default && (
          <button
            onClick={() => onSetDefault(i.id, i.name)}
            className="h-6 px-2 rounded text-[10px] hover:bg-white/[0.06] flex items-center gap-1 opacity-70 hover:opacity-100"
          >
            <Star className="w-2.5 h-2.5" /> Default
          </button>
        )}
        <button
          onClick={() => onEdit(i)}
          className="h-6 px-2 rounded text-[10px] hover:bg-white/[0.06] flex items-center gap-1 opacity-70 hover:opacity-100"
        >
          <Edit3 className="w-2.5 h-2.5" /> Edit
        </button>
        <div className="flex-1 min-w-0" />
        <button
          onClick={() => onDelete(i.id, i.name)}
          className="h-6 px-2 rounded text-[10px] hover:bg-rose-500/10 hover:text-rose-400 opacity-50 hover:opacity-100"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* One-click automations */}
      {automations.length > 0 && (
        <div className="mt-2 pt-2 border-t flex flex-wrap gap-1" style={{ borderColor: 'var(--surface-border)' }}>
          {automations.map((a) => {
            const runKey = `${i.id}:${a.id}`;
            const isRunning = runningAutomation === runKey;
            return (
              <button
                key={a.id}
                onClick={() => onAutomate(i, a.id, a.label)}
                disabled={isRunning}
                className="h-6 px-2 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 disabled:opacity-50"
              >
                {isRunning ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Zap className="w-2.5 h-2.5" />}
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Connect / Edit modal (unchanged structure, kept inline) ───

function ConnectModal({ typeId, typeMeta, existing, onClose, onSaved }) {
  const create = useIntegrationsStore((s) => s.create);
  const update = useIntegrationsStore((s) => s.update);
  const test = useIntegrationsStore((s) => s.test);
  const [name, setName] = useState(existing?.name || `My ${typeMeta?.name}`);
  const [values, setValues] = useState(() => {
    const v = {};
    typeMeta?.fields?.forEach((f) => {
      v[f.key] = existing?.config?.[f.key] || '';
    });
    return v;
  });
  const [saving, setSaving] = useState(false);

  const fields = typeMeta?.fields || [];

  const handleSave = async () => {
    setSaving(true);
    try {
      const config = {};
      const credentials = {};
      for (const f of fields) {
        const val = values[f.key];
        if (f.type === 'secret') {
          if (val) credentials[f.key] = val;
        } else {
          config[f.key] = val;
        }
      }
      let saved;
      if (existing) {
        saved = await update(existing.id, { name, config, credentials });
      } else {
        saved = await create({ type: typeId, name, config, credentials });
      }
      const result = await test(saved.id);
      notify({
        title: result.ok ? `${typeMeta.name} connected` : `Saved with errors`,
        message: result.ok ? name : (result.error || 'Test failed'),
        category: 'system',
        level: result.ok ? 'success' : 'warning',
      });
      onSaved();
    } catch (err) {
      notify({ title: 'Save failed', message: err.message, category: 'error', level: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 h-12 flex items-center justify-between border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 opacity-70" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>
              {existing ? 'Edit' : 'Connect'} {typeMeta?.name}
            </span>
          </div>
          <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <p className="text-[11px] opacity-60">{typeMeta?.description}</p>
          <div>
            <label className="text-[10px] uppercase tracking-wider opacity-50">Connection name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 mt-1 px-2 rounded-md bg-white/[0.04] border outline-none text-xs"
              style={{ borderColor: 'var(--surface-border)', color: 'var(--text-on-surface)' }}
            />
          </div>
          {fields.map((f) => (
            <div key={f.key}>
              <label className="text-[10px] uppercase tracking-wider opacity-50">
                {f.label} {f.required && <span className="text-rose-400">*</span>}
              </label>
              <input
                type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full h-8 mt-1 px-2 rounded-md bg-white/[0.04] border outline-none text-xs font-mono"
                style={{ borderColor: 'var(--surface-border)', color: 'var(--text-on-surface)' }}
              />
            </div>
          ))}
        </div>
        <div className="px-4 h-12 border-t flex items-center justify-end gap-2 shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
          <button onClick={onClose} className="h-7 px-3 rounded-md text-[11px] hover:bg-white/[0.05]">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-7 px-3 rounded-md text-[11px] bg-primary/85 hover:bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {existing ? 'Save & test' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
