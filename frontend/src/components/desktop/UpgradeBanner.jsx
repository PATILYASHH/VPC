import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RotateCcw, AlertTriangle, X, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { subscribe } from '@/lib/realtime';

export default function UpgradeBanner() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [waitingForReboot, setWaitingForReboot] = useState(false);

  async function load() {
    try {
      const { data } = await api.get('/admin/upgrade/status');
      setState(data);
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    const unsub = subscribe('upgrade:pending', () => load());
    return () => { clearInterval(t); unsub?.(); };
  }, []);

  async function restart() {
    setRestarting(true);
    try {
      await api.post('/admin/upgrade/restart');
      setWaitingForReboot(true);
      toast.info('Server restarting… page will reload when it comes back.');
      // Poll health every 2s until the server returns fresh
      const start = Date.now();
      const poll = setInterval(async () => {
        try {
          const fresh = await fetch('/health', { cache: 'no-store' });
          if (fresh.ok) {
            clearInterval(poll);
            toast.success('Server is back — reloading to fetch new UI');
            setTimeout(() => window.location.reload(true), 800);
          }
        } catch { /* still down */ }
        if (Date.now() - start > 60_000) {
          clearInterval(poll);
          setWaitingForReboot(false);
          setRestarting(false);
          toast.error('Server did not come back in 60s — check supervisor (PM2/systemd)');
        }
      }, 2000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Restart failed');
      setRestarting(false);
    }
  }

  async function dismiss() {
    try { await api.post('/admin/upgrade/acknowledge'); } catch {}
    setDismissed(true);
  }

  if (!state) return null;
  if (dismissed) return null;
  if (!state.needs_restart && !state.pending_restart && state.remote_ahead === 0) return null;

  // Reason: either running commit differs from disk, or pending flag is set
  const running = state.running?.commit_short;
  const onDisk = state.on_disk?.commit_short;
  const from = state.pending_restart?.from_commit?.slice(0, 7);
  const to = state.pending_restart?.to_commit?.slice(0, 7);

  return (
    <div
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] w-[min(680px,calc(100vw-16px))] rounded-xl border shadow-2xl flex items-center gap-3 px-4 py-2.5"
      style={{
        background: 'linear-gradient(to right, rgba(234,179,8,0.10), rgba(234,179,8,0.06))',
        borderColor: 'rgba(234,179,8,0.35)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
        {waitingForReboot ? (
          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {waitingForReboot ? (
          <>
            <div className="text-xs font-semibold text-amber-300">Restarting server…</div>
            <div className="text-[10px] text-muted-foreground/80">Reloading automatically once back online.</div>
          </>
        ) : state.needs_restart ? (
          <>
            <div className="text-xs font-semibold text-amber-300">
              Server is running old code · restart required
            </div>
            <div className="text-[10px] text-muted-foreground/80 font-mono">
              Booted from {running} · new code on disk {onDisk}
              {state.frontend_build_at && <> · frontend built {new Date(state.frontend_build_at).toLocaleString()}</>}
            </div>
          </>
        ) : state.pending_restart ? (
          <>
            <div className="text-xs font-semibold text-amber-300">Upgrade applied — restart to run new version</div>
            <div className="text-[10px] text-muted-foreground/80 font-mono">
              {from && to ? <>commit {from} → {to}</> : 'pending restart'}
            </div>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold text-amber-300">
              Updates available ({state.remote_ahead} commit{state.remote_ahead === 1 ? '' : 's'} behind)
            </div>
            <div className="text-[10px] text-muted-foreground/80">
              Enable Auto-Upgrade in Settings, or pull manually then restart.
            </div>
          </>
        )}
      </div>

      {(state.needs_restart || state.pending_restart) && !waitingForReboot && (
        <button
          onClick={restart}
          disabled={restarting}
          className="h-7 px-3 rounded-md text-[11px] font-semibold bg-amber-500/90 hover:bg-amber-500 text-black flex items-center gap-1.5 disabled:opacity-60"
        >
          {restarting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Restart Now
        </button>
      )}

      {!waitingForReboot && (
        <button onClick={dismiss} className="p-1 opacity-60 hover:opacity-100" title="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
