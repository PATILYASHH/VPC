import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Cloud, Plus, Play, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2,
  Clock, Shield, AlertTriangle, X, Link as LinkIcon, Zap, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import useWindowStore from '@/stores/useWindowStore';

function bytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function ago(t) {
  if (!t) return 'Never';
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function until(t) {
  if (!t) return '—';
  const s = Math.floor((new Date(t).getTime() - Date.now()) / 1000);
  if (s < 0) return 'due';
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86400)}d`;
}

const INTERVAL_OPTIONS = [
  { v: 60, l: 'Hourly' },
  { v: 360, l: '6h' },
  { v: 720, l: '12h' },
  { v: 1440, l: 'Daily' },
  { v: 10080, l: 'Weekly' },
];

export default function BackupDestinations() {
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const { data } = await api.get('/admin/backup/destinations');
      setDestinations(data.destinations || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load destinations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function runNow(id) {
    setBusyId(id);
    toast.promise(
      api.post(`/admin/backup/destinations/${id}/run`).then(() => load()),
      { loading: 'Uploading to Supabase…', success: 'Pushed', error: (e) => e.response?.data?.error || 'Push failed' }
    ).finally(() => setBusyId(null));
  }

  async function testConn(id) {
    setBusyId(id);
    try {
      await api.post(`/admin/backup/destinations/${id}/test`);
      toast.success('Connection OK');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test failed');
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(d) {
    try {
      await api.patch(`/admin/backup/destinations/${d.id}`, { enabled: !d.enabled });
      load();
    } catch { toast.error('Failed to toggle'); }
  }

  async function setInterval_(d, mins) {
    try {
      await api.patch(`/admin/backup/destinations/${d.id}`, { interval_minutes: mins });
      toast.success(`Interval: every ${mins} min`);
      load();
    } catch { toast.error('Failed'); }
  }

  async function remove(id) {
    if (!confirm('Remove this backup destination? Schedules will stop.')) return;
    try {
      await api.delete(`/admin/backup/destinations/${id}`);
      toast.success('Removed');
      load();
    } catch { toast.error('Failed'); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          Cloud Destinations ({destinations.length})
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="text-xs h-7">
          <Plus className="w-3.5 h-3.5 mr-1" /> Add Supabase
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-6 text-muted-foreground text-xs">Loading…</div>
      ) : destinations.length === 0 ? (
        <div
          onClick={() => setShowAdd(true)}
          className="border border-dashed rounded-xl p-5 text-center cursor-pointer hover:border-primary/30 transition-colors"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          <Cloud className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs font-medium">No cloud backup destinations yet</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Connect Supabase to push every backup off-site automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {destinations.map(d => (
            <div key={d.id} className="border rounded-xl p-4 bg-card">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Cloud className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{d.name}</h3>
                    <Badge variant="outline" className="text-[8px] uppercase">{d.provider}</Badge>
                    {d.enabled ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[8px]">ON</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground text-[8px]">OFF</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground font-mono truncate">
                    <LinkIcon className="w-2.5 h-2.5" />
                    {d.config?.url}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-2">
                    <span className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      Last: {ago(d.last_run_at)}
                    </span>
                    <span>Next: {d.enabled ? until(d.next_run_at) : 'paused'}</span>
                    <span>Size: {bytes(d.last_run_bytes)}</span>
                  </div>

                  {/* Status */}
                  <div className="mt-1.5 flex items-center gap-2">
                    {d.last_run_status === 'success' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Last run OK
                      </span>
                    )}
                    {d.last_run_status === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-red-400" title={d.last_run_error}>
                        <XCircle className="w-2.5 h-2.5" /> Last run failed
                      </span>
                    )}
                    {d.last_run_status === 'running' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Running…
                      </span>
                    )}
                    {!d.last_run_status && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                        <AlertTriangle className="w-2.5 h-2.5" /> Never run
                      </span>
                    )}
                  </div>

                  {/* Interval picker */}
                  <div className="flex items-center gap-1 mt-3">
                    <span className="text-[10px] text-muted-foreground mr-1">Every</span>
                    {INTERVAL_OPTIONS.map(o => (
                      <button
                        key={o.v}
                        onClick={() => setInterval_(d, o.v)}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
                          d.interval_minutes === o.v
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >{o.l}</button>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => runNow(d.id)}
                    disabled={busyId === d.id}
                    title="Run now"
                    className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                  >
                    {busyId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => testConn(d.id)}
                    disabled={busyId === d.id}
                    title="Test connection"
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggle(d)}
                    title={d.enabled ? 'Pause' : 'Enable'}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground"
                  >
                    <Shield className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => remove(d.id)}
                    title="Delete"
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddFromConnectionsModal onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

// ─── Add from Connections Modal ─────────────────────────────
// One-click: pick an existing Supabase integration from the Connections app and
// automatically create a backup destination using its stored service-role key.

function AddFromConnectionsModal({ onClose }) {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const openWindow = useWindowStore((s) => s.openWindow);

  useEffect(() => {
    api.get('/admin/integrations/by-type/supabase')
      .then(({ data }) => setIntegrations(data.integrations || []))
      .catch(() => setIntegrations([]))
      .finally(() => setLoading(false));
  }, []);

  async function useAsDestination(id) {
    setRunning(id);
    try {
      await api.post(`/admin/integrations/${id}/automate`, { automation: 'add-as-backup' });
      toast.success('Supabase added as backup destination');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setRunning(null);
    }
  }

  function openConnections() {
    openWindow?.({ appId: 'connections' });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-5 mx-4"
        style={{ borderColor: 'var(--surface-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Cloud className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Use Supabase as backup target</h3>
              <p className="text-[10px] text-muted-foreground">
                Pick a Supabase connection from your Connections app.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">Loading…</div>
        ) : integrations.length === 0 ? (
          <div className="border border-dashed rounded-xl p-4 text-center" style={{ borderColor: 'var(--surface-border)' }}>
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
            <p className="text-xs font-medium">No Supabase connections yet</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 mb-3">
              Connect a Supabase project in the Connections app first — include the Service Role Key.
            </p>
            <Button variant="outline" onClick={openConnections} className="text-xs">
              <ExternalLink className="w-3 h-3 mr-1.5" /> Open Connections
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {integrations.map((i) => {
              const hasServiceKey = !!i.metadata?.hasServiceKey;
              return (
                <div
                  key={i.id}
                  className="flex items-center gap-3 p-3 border rounded-xl"
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Cloud className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold truncate">{i.name}</span>
                      {i.is_default && <Badge variant="outline" className="text-[8px]">DEFAULT</Badge>}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {i.config?.url || 'no URL'}
                    </div>
                    {!hasServiceKey && (
                      <div className="text-[10px] text-amber-400 mt-0.5">
                        ⚠ Needs Service Role Key — edit in Connections
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => useAsDestination(i.id)}
                    disabled={running === i.id || !hasServiceKey}
                    className="text-xs"
                  >
                    {running === i.id
                      ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                      : <Zap className="w-3.5 h-3.5 mr-1" />}
                    Use
                  </Button>
                </div>
              );
            })}

            <button
              onClick={openConnections}
              className="w-full border border-dashed rounded-xl p-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
              style={{ borderColor: 'var(--surface-border)' }}
            >
              + Add a new Supabase connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
