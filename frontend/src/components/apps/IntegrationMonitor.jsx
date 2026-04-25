import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Trash2, Play, Pencil, Loader2, CheckCircle2, XCircle,
  Github, Database, Cloud, Shield, MessageSquare, Mail, Box,
  RefreshCw, ExternalLink, Plug, AlertTriangle, Activity, Clock,
  ChevronDown, ChevronUp, Server, Zap,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const TYPE_UI = {
  github: { icon: Github, gradient: 'from-[#24292e] to-[#1a1e22]', label: 'GitHub' },
  supabase: { icon: Database, gradient: 'from-[#3ecf8e] to-[#2da672]', label: 'Supabase' },
  docker: { icon: Box, gradient: 'from-[#2496ed] to-[#1a7bc9]', label: 'Docker Hub' },
  cloudflare: { icon: Shield, gradient: 'from-[#f6821f] to-[#d6710e]', label: 'Cloudflare' },
  slack: { icon: MessageSquare, gradient: 'from-[#4a154b] to-[#3a1039]', label: 'Slack' },
  discord: { icon: MessageSquare, gradient: 'from-[#5865f2] to-[#4752c4]', label: 'Discord' },
  smtp: { icon: Mail, gradient: 'from-[#ea4335] to-[#c5372c]', label: 'SMTP Email' },
};

const STATUS_BADGE = {
  connected: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  disconnected: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  error: 'bg-red-500/15 text-red-400 border-red-500/25',
};

const APP_LABELS = {
  'web-hosting': 'Web Hosting',
  'vpshub': 'VPSHub',
  'pipeline': 'Pipeline',
  'db': 'Database',
  'backup': 'Backups',
  'gallery': 'Gallery',
  'unknown': 'Other',
};

function formatRelative(dateStr) {
  if (!dateStr) return 'never';
  const ms = Date.now() - new Date(dateStr).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ─── Main Component ──────────────────────────────────────────

export default function IntegrationMonitor() {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useApiQuery('integrations', '/admin/integrations', { refetchInterval: 30000 });
  const integrations = data?.integrations || [];

  const totals = useMemo(() => {
    let totalUses = 0, totalApps = 0, connected = 0;
    let lastUsed = null;
    const appSet = new Set();
    for (const int of integrations) {
      const u = int.usage || {};
      totalUses += u.total_uses || 0;
      for (const a of (u.apps || [])) appSet.add(a.app_id);
      if (int.status === 'connected') connected += 1;
      if (u.last_used_at && (!lastUsed || new Date(u.last_used_at) > new Date(lastUsed))) {
        lastUsed = u.last_used_at;
      }
    }
    totalApps = appSet.size;
    return { totalUses, totalApps, connected, lastUsed };
  }, [integrations]);

  async function handleTest(id) {
    setTesting((p) => ({ ...p, [id]: true }));
    try {
      const { data: result } = await api.post(`/admin/integrations/${id}/test`);
      setTestResults((p) => ({ ...p, [id]: result }));
      if (result.ok) toast.success(`Connected (${result.latency}ms)`);
      else toast.error(result.error || 'Connection failed');
      refetch();
    } catch (err) {
      setTestResults((p) => ({ ...p, [id]: { ok: false, error: err.message } }));
      toast.error('Test failed');
    } finally {
      setTesting((p) => ({ ...p, [id]: false }));
    }
  }

  async function handleDelete(id, name) {
    if (!confirm(`Remove "${name}"?\n\nSaved credentials will be deleted.`)) return;
    try {
      await api.delete(`/admin/integrations/${id}`);
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Removed');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
        <div>
          <h2 className="text-sm font-bold">Integrations</h2>
          <p className="text-[11px] text-muted-foreground/50">
            {integrations.length} service{integrations.length !== 1 ? 's' : ''} ·{' '}
            {totals.connected} connected
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" /> Connect Service
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-5 space-y-4">
          {integrations.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.1), rgba(59,130,246,0.1))' }}>
                <Plug className="w-8 h-8 text-teal-400/40" />
              </div>
              <h3 className="text-sm font-semibold mb-1">No integrations yet</h3>
              <p className="text-xs text-muted-foreground/40 max-w-xs mb-4">
                Connect GitHub, Supabase, Cloudflare, Slack, and more — manage everything from VPC.
              </p>
              <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Connect Your First Service
              </Button>
            </div>
          ) : (
            <>
              {/* Stats summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile icon={Plug} label="Connected" value={`${totals.connected}/${integrations.length}`} accent="emerald" />
                <StatTile icon={Activity} label="Total Uses" value={totals.totalUses.toLocaleString()} accent="blue" />
                <StatTile icon={Server} label="Apps Using" value={totals.totalApps} accent="violet" />
                <StatTile icon={Clock} label="Last Activity" value={formatRelative(totals.lastUsed)} accent="amber" />
              </div>

              {/* Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {integrations.map((int) => (
                  <IntegrationCard
                    key={int.id}
                    integration={int}
                    testing={testing[int.id]}
                    testResult={testResults[int.id]}
                    onTest={() => handleTest(int.id)}
                    onEdit={() => setEditId(int.id)}
                    onDelete={() => handleDelete(int.id, int.name)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <AddIntegrationDialog open={showAdd} onOpenChange={setShowAdd} onSaved={() => queryClient.invalidateQueries({ queryKey: ['integrations'] })} />
      {editId && <EditIntegrationDialog integrationId={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); queryClient.invalidateQueries({ queryKey: ['integrations'] }); }} />}
    </div>
  );
}

// ─── Stat Tile ───────────────────────────────────────────────

function StatTile({ icon: Icon, label, value, accent = 'blue' }) {
  const accentMap = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    violet: 'text-violet-400 bg-violet-500/10',
    amber: 'text-amber-400 bg-amber-500/10',
  };
  return (
    <div className="rounded-lg border p-3 flex items-center gap-3" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', accentMap[accent])}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}

// ─── Integration Card ────────────────────────────────────────

function IntegrationCard({ integration: int, testing, testResult, onTest, onEdit, onDelete }) {
  const ui = TYPE_UI[int.type] || TYPE_UI.github;
  const Icon = ui.icon;
  const meta = int.metadata || {};
  const usage = int.usage || { total_uses: 0, unique_apps: 0, apps: [], last_used_at: null };
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--surface-border)' }}>
      {/* Gradient header */}
      <div className={`flex items-center gap-3 px-4 py-3 bg-gradient-to-r ${ui.gradient}`}>
        <div className="w-9 h-9 rounded-lg bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-white truncate">{int.name}</h4>
          <p className="text-[10px] text-white/50">{ui.label}</p>
        </div>
        <Badge className={`text-[9px] border ${STATUS_BADGE[int.status] || STATUS_BADGE.disconnected}`}>
          {int.status}
        </Badge>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5" style={{ background: 'var(--surface-1)' }}>
        {/* Type-specific metadata */}
        <MetadataDisplay type={int.type} metadata={meta} config={int.config} />

        {/* Usage strip */}
        <div className="flex items-center gap-3 py-1.5 px-2.5 rounded-md text-[11px]" style={{ background: 'var(--surface-0)' }}>
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <Activity className="w-3 h-3" />
            <span>
              <span className="font-semibold text-foreground/90">{usage.total_uses.toLocaleString()}</span>{' '}
              use{usage.total_uses === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <Server className="w-3 h-3" />
            <span>
              <span className="font-semibold text-foreground/90">{usage.unique_apps}</span>{' '}
              app{usage.unique_apps === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <Clock className="w-3 h-3" />
            <span title={usage.last_used_at ? new Date(usage.last_used_at).toLocaleString() : ''}>
              {formatRelative(usage.last_used_at)}
            </span>
          </div>
        </div>

        {/* Per-app breakdown (collapsible) */}
        {usage.apps && usage.apps.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Hide' : 'Show'} usage by app
            </button>
            {expanded && (
              <div className="mt-2 space-y-1.5">
                {usage.apps.map((a) => (
                  <div
                    key={a.app_id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] border"
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <Zap className="w-3 h-3 text-teal-400/70 shrink-0" />
                    <span className="font-medium">{APP_LABELS[a.app_id] || a.app_id}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                      {a.count} {a.count === 1 ? 'use' : 'uses'}
                    </Badge>
                    <div className="flex-1" />
                    <span className="text-muted-foreground/50" title={new Date(a.last_used_at).toLocaleString()}>
                      {formatRelative(a.last_used_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Last verified */}
        {int.last_checked_at && (
          <p className="text-[10px] text-muted-foreground/30">
            Verified {formatRelative(int.last_checked_at)}
          </p>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-1.5 text-[11px] ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {testResult.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {testResult.ok ? `Connected in ${testResult.latency}ms` : testResult.error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 pt-2 border-t" style={{ borderColor: 'var(--surface-border)' }}>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Test
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={onEdit}>
            <Pencil className="w-3 h-3" /> Edit
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function MetadataDisplay({ type, metadata: m, config }) {
  if (!m || Object.keys(m).length === 0) {
    return <p className="text-[11px] text-muted-foreground/30">Not verified yet — click Test</p>;
  }

  switch (type) {
    case 'github':
      return (
        <div className="flex items-center gap-2 text-xs">
          {m.avatar_url && <img src={m.avatar_url} className="w-5 h-5 rounded-full" alt="" />}
          <span className="font-medium">{m.login || m.name}</span>
          {m.public_repos !== undefined && <span className="text-muted-foreground/40">{m.public_repos} repos</span>}
          {m.plan && <Badge variant="outline" className="text-[8px] ml-auto">{m.plan}</Badge>}
        </div>
      );
    case 'supabase':
      return <p className="text-[11px] text-muted-foreground/50 font-mono truncate">{config?.url || m.url}</p>;
    case 'docker':
      return <p className="text-xs"><span className="font-medium">{m.username}</span> <span className="text-muted-foreground/40">{m.repos} images</span></p>;
    case 'cloudflare':
      return <p className="text-[11px] text-muted-foreground/50">{m.email} <span className="text-emerald-400/60">{m.status}</span></p>;
    case 'smtp':
      return <p className="text-[11px] text-muted-foreground/50 font-mono">{m.host}:{m.port} &rarr; {m.from}</p>;
    case 'slack':
    case 'discord':
      return <p className="text-[11px] text-muted-foreground/50">Webhook active {m.channel ? `(${m.channel})` : ''}</p>;
    default:
      return null;
  }
}

// ─── Add Dialog ──────────────────────────────────────────────

function AddIntegrationDialog({ open, onOpenChange, onSaved }) {
  const [types, setTypes] = useState(null);
  const [step, setStep] = useState('select');
  const [selectedType, setSelectedType] = useState(null);
  const [name, setName] = useState('');
  const [formValues, setFormValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('select'); setSelectedType(null); setName(''); setFormValues({}); setFilter('');
    api.get('/admin/integrations/types').then(({ data }) => setTypes(data.types)).catch(() => {});
  }, [open]);

  function selectType(type) {
    setSelectedType(type);
    setName(types[type]?.name || type);
    setFormValues({});
    setStep('configure');
  }

  async function handleSave() {
    if (!selectedType || !name) return;
    setSaving(true);
    try {
      const typeDef = types[selectedType];
      const config = {};
      const credentials = {};
      for (const f of (typeDef?.fields || [])) {
        const val = formValues[f.key];
        if (f.required && !val) { toast.error(`${f.label} is required`); setSaving(false); return; }
        if (f.type === 'secret') credentials[f.key] = val || '';
        else config[f.key] = f.type === 'number' ? (val || '') : (val || '');
      }

      const { data } = await api.post('/admin/integrations', { type: selectedType, name, config, credentials });
      try { await api.post(`/admin/integrations/${data.integration.id}/test`); } catch {}
      toast.success(`${name} connected`);
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  // Filter and group types by category for the picker
  const grouped = useMemo(() => {
    if (!types) return [];
    const f = filter.trim().toLowerCase();
    const all = Object.entries(types)
      .filter(([key, def]) => {
        if (!f) return true;
        return (
          def.name.toLowerCase().includes(f) ||
          def.description?.toLowerCase().includes(f) ||
          def.category?.toLowerCase().includes(f) ||
          key.toLowerCase().includes(f)
        );
      });
    const byCat = {};
    for (const entry of all) {
      const cat = entry[1].category || 'Other';
      (byCat[cat] = byCat[cat] || []).push(entry);
    }
    return Object.entries(byCat); // [[catName, [[key, def], ...]], ...]
  }, [types, filter]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>{step === 'select' ? 'Connect a Service' : `Configure ${types?.[selectedType]?.name}`}</DialogTitle>
        </DialogHeader>

        {step === 'select' && types && (
          <div className="flex flex-col flex-1 min-h-0 -mx-6">
            <div className="px-6 pb-3 shrink-0">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search GitHub, Slack, AWS…"
                className="text-sm h-9"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-2">
              {grouped.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted-foreground/50">
                  No services match "{filter}"
                </div>
              ) : (
                <div className="space-y-5">
                  {grouped.map(([cat, entries]) => (
                    <div key={cat}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-2 sticky top-0 py-1" style={{ background: 'var(--surface-0)' }}>
                        {cat}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {entries.map(([key, def]) => {
                          const ui = TYPE_UI[key];
                          const Icon = ui?.icon || Plug;
                          return (
                            <button
                              key={key}
                              onClick={() => selectType(key)}
                              className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:border-primary/50 active:scale-[0.97] group"
                              style={{ borderColor: 'var(--surface-border)' }}
                            >
                              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${ui?.gradient || 'from-zinc-500 to-zinc-600'} flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform`}>
                                <Icon className="w-5 h-5 text-white" />
                              </div>
                              <div className="text-center min-h-[2.5rem]">
                                <p className="text-xs font-semibold leading-tight">{def.name}</p>
                                <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-tight line-clamp-2">{def.description}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 'configure' && types?.[selectedType] && (
          <div className="space-y-3 flex-1 overflow-y-auto -mx-6 px-6">
            <button onClick={() => setStep('select')} className="text-[11px] text-muted-foreground hover:text-foreground">&larr; Back</button>

            <div className="space-y-1.5">
              <Label className="text-xs">Display Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
            </div>

            {types[selectedType].fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label className="text-xs">{f.label} {f.required && <span className="text-red-400">*</span>}</Label>
                <Input
                  type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                  value={formValues[f.key] || ''}
                  onChange={(e) => setFormValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder || ''}
                  className="text-sm font-mono"
                />
              </div>
            ))}

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !name}>
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Connecting...</> : <><Plug className="w-3.5 h-3.5 mr-1.5" /> Test & Save</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Dialog ─────────────────────────────────────────────

function EditIntegrationDialog({ integrationId, onClose, onSaved }) {
  const [integration, setIntegration] = useState(null);
  const [types, setTypes] = useState(null);
  const [name, setName] = useState('');
  const [formValues, setFormValues] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/admin/integrations'),
      api.get('/admin/integrations/types'),
    ]).then(([intRes, typeRes]) => {
      const int = (intRes.data.integrations || []).find((i) => i.id === integrationId);
      setIntegration(int);
      setTypes(typeRes.data.types);
      if (int) { setName(int.name); setFormValues(int.config || {}); }
    }).catch(() => toast.error('Failed to load'));
  }, [integrationId]);

  async function handleSave() {
    setSaving(true);
    try {
      const typeDef = types?.[integration?.type];
      const config = {};
      const credentials = {};
      for (const f of (typeDef?.fields || [])) {
        const val = formValues[f.key];
        if (f.type === 'secret' && val) credentials[f.key] = val;
        else if (f.type !== 'secret') config[f.key] = val || '';
      }
      await api.put(`/admin/integrations/${integrationId}`, { name, config, ...(Object.keys(credentials).length > 0 ? { credentials } : {}) });
      toast.success('Updated');
      if (onSaved) onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  if (!integration || !types) return null;
  const typeDef = types[integration.type];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit {integration.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Display Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
          </div>
          {typeDef?.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-xs">{f.label}</Label>
              <Input
                type={f.type === 'secret' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                value={formValues[f.key] || ''}
                onChange={(e) => setFormValues((p) => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.type === 'secret' ? 'Leave blank to keep current' : (f.placeholder || '')}
                className="text-sm font-mono"
              />
              {f.type === 'secret' && <p className="text-[9px] text-muted-foreground/30">Leave blank to keep existing value</p>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</> : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
