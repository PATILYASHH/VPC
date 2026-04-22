import { Activity, Loader2, CheckCircle2, AlertCircle, Ban } from 'lucide-react';
import useJobStore from '@/stores/useJobStore';
import WidgetShell from './WidgetShell';

export default function JobQueueWidget({ onRemove }) {
  const jobs = useJobStore((s) => s.jobs);
  const list = Object.values(jobs).sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);

  return (
    <WidgetShell title="Active Jobs" icon={Activity} onRemove={onRemove}>
      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full opacity-40 gap-1.5">
          <Activity className="w-5 h-5" />
          <span className="text-[10px]">No jobs</span>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--surface-border)' }}>
          {list.map((j) => (
            <div key={j.id} className="px-3 py-2 flex items-center gap-2">
              {j.status === 'running' ? (
                <Loader2 className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
              ) : j.status === 'success' ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
              ) : j.status === 'canceled' ? (
                <Ban className="w-3 h-3 text-amber-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] truncate" style={{ color: 'var(--text-on-surface)' }}>{j.label}</div>
                {j.status === 'running' && (
                  <div className="h-0.5 mt-0.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full bg-blue-500/70" style={{ width: `${j.progress || 5}%` }} />
                  </div>
                )}
              </div>
              <span className="text-[9px] opacity-40 capitalize">{j.type}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
