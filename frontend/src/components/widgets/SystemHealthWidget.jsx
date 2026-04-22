import { useEffect, useState } from 'react';
import { HeartPulse, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import WidgetShell from './WidgetShell';
import api from '@/lib/api';

function severityFor(errors, warnings) {
  if (errors > 0) return 'error';
  if (warnings > 0) return 'warn';
  return 'ok';
}

export default function SystemHealthWidget({ onRemove }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get('/admin/logs/health')
        .then(({ data }) => alive && setData(data))
        .catch((e) => alive && setErr(e.message));
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (err) {
    return (
      <WidgetShell title="System Health" icon={HeartPulse} onRemove={onRemove}>
        <div className="p-3 text-[11px] text-rose-400">Unavailable: {err}</div>
      </WidgetShell>
    );
  }

  if (!data) {
    return (
      <WidgetShell title="System Health" icon={HeartPulse} onRemove={onRemove}>
        <div className="p-3 text-[11px] opacity-50">Loading…</div>
      </WidgetShell>
    );
  }

  const warnCount = Object.values(data.sources || {}).reduce((a, s) => a + (s.warn || 0), 0);
  const sev = severityFor(data.errors_24h, warnCount);

  return (
    <WidgetShell title="System Health" icon={HeartPulse} onRemove={onRemove}>
      <div className="p-3 space-y-3">
        {/* Headline */}
        <div className="flex items-center gap-2">
          {sev === 'ok' ? (
            <><CheckCircle2 className="w-6 h-6 text-emerald-400" /><div><div className="text-xs font-semibold">All systems nominal</div><div className="text-[10px] opacity-50">Last 24h: no errors</div></div></>
          ) : sev === 'warn' ? (
            <><AlertCircle className="w-6 h-6 text-amber-400" /><div><div className="text-xs font-semibold">{warnCount} warning{warnCount !== 1 ? 's' : ''}</div><div className="text-[10px] opacity-50">No errors in 24h</div></div></>
          ) : (
            <><AlertTriangle className="w-6 h-6 text-rose-400" /><div><div className="text-xs font-semibold text-rose-400">{data.errors_24h} error{data.errors_24h !== 1 ? 's' : ''}</div><div className="text-[10px] opacity-50">in the last 24h</div></div></>
          )}
        </div>

        {/* By source */}
        {Object.keys(data.sources || {}).length > 0 && (
          <div className="space-y-1 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
            <div className="text-[9px] uppercase tracking-wider opacity-50 mb-1">By source</div>
            {Object.entries(data.sources).map(([src, counts]) => (
              <div key={src} className="flex items-center justify-between text-[10px]">
                <span className="font-mono opacity-70">{src}</span>
                <span className="flex items-center gap-2">
                  {counts.error > 0 && <span className="text-rose-400">{counts.error} err</span>}
                  {counts.warn > 0 && <span className="text-amber-400">{counts.warn} warn</span>}
                  {!counts.error && !counts.warn && <span className="text-emerald-500/60">ok</span>}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent */}
        {data.recent?.length > 0 && (
          <div className="space-y-1 border-t pt-2" style={{ borderColor: 'var(--surface-border)' }}>
            <div className="text-[9px] uppercase tracking-wider opacity-50 mb-1">Recent issues</div>
            {data.recent.slice(0, 4).map(r => (
              <div key={r.id} className="flex items-start gap-1.5 text-[10px]">
                <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${r.level === 'error' || r.level === 'fatal' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="truncate opacity-90">{r.message}</div>
                  <div className="opacity-40 text-[9px]">{r.source} · {new Date(r.created_at).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
