import { useMemo } from 'react';
import { Activity, X, CheckCircle2, AlertCircle, Loader2, Trash2, Rocket, Database, Terminal as TermIcon, GitMerge, Bot, Upload, Zap, Ban } from 'lucide-react';
import { format } from 'date-fns';
import useJobStore from '@/stores/useJobStore';

const TYPE_ICONS = {
  deploy: Rocket,
  backup: Database,
  terminal: TermIcon,
  git: GitMerge,
  ai: Bot,
  upload: Upload,
  task: Zap,
};

function fmtDuration(start, end) {
  const ms = (end || Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export default function JobQueue() {
  const jobs = useJobStore((s) => s.jobs);
  const panelOpen = useJobStore((s) => s.panelOpen);
  const togglePanel = useJobStore((s) => s.togglePanel);
  const closePanel = useJobStore((s) => s.closePanel);
  const cancelJob = useJobStore((s) => s.cancelJob);
  const removeJob = useJobStore((s) => s.removeJob);
  const clearFinished = useJobStore((s) => s.clearFinished);

  const list = useMemo(() => Object.values(jobs).sort((a, b) => b.startedAt - a.startedAt), [jobs]);
  const running = list.filter((j) => j.status === 'running');
  const total = list.length;

  if (total === 0) return null;

  return (
    <>
      {/* Floating chip in taskbar slot */}
      <button
        onClick={togglePanel}
        className="fixed bottom-[52px] right-2 z-[9997] h-9 px-3 rounded-full border backdrop-blur-xl flex items-center gap-2 text-xs shadow-lg hover:scale-[1.02] transition-transform"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)', color: 'var(--text-on-surface)' }}
      >
        {running.length > 0 ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
        ) : (
          <Activity className="w-3.5 h-3.5 opacity-60" />
        )}
        <span className="font-medium">
          {running.length > 0 ? `${running.length} running` : `${total} jobs`}
        </span>
        {running.length > 0 && total - running.length > 0 && (
          <span className="text-[10px] opacity-50">· {total - running.length} done</span>
        )}
      </button>

      {/* Panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-[99997]" onClick={closePanel}>
          <div
            className="absolute right-2 bottom-[100px] w-[420px] max-h-[60vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col animate-slide-up"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-12 border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 opacity-70" />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Job Queue</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] opacity-60">{total}</span>
              </div>
              <button
                onClick={clearFinished}
                className="h-7 px-2 rounded-md text-[10px] hover:bg-rose-500/10 hover:text-rose-400 opacity-70 hover:opacity-100 flex items-center gap-1"
                title="Remove finished jobs"
              >
                <Trash2 className="w-3 h-3" /> Clear done
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {list.map((j) => {
                const Icon = TYPE_ICONS[j.type] || Zap;
                const status = j.status;
                return (
                  <div
                    key={j.id}
                    className="group px-3 py-2.5 border-b hover:bg-white/[0.02] transition-colors"
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                        {status === 'running' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : status === 'success' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : status === 'canceled' ? (
                          <Ban className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className="w-3 h-3 opacity-50 shrink-0" />
                          <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>
                            {j.label}
                          </span>
                        </div>
                        {/* Progress */}
                        {status === 'running' && (
                          <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                            <div
                              className="h-full bg-blue-500/70 transition-all"
                              style={{ width: `${j.progress || 5}%` }}
                            />
                          </div>
                        )}
                        {/* Last log line */}
                        {j.logs.length > 0 && (
                          <div className="text-[10px] opacity-50 mt-1 font-mono truncate">
                            › {j.logs[j.logs.length - 1].text}
                          </div>
                        )}
                        {j.error && (
                          <div className="text-[10px] text-rose-400 mt-1 line-clamp-2">{j.error}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] opacity-40">
                            {status === 'running' ? 'running' : status} · {fmtDuration(j.startedAt, j.finishedAt)}
                          </span>
                          {j.app && <span className="text-[9px] opacity-40">· {j.app}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {status === 'running' && j.cancelable && (
                          <button
                            onClick={() => cancelJob(j.id)}
                            className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 rounded transition-opacity"
                            title="Cancel"
                          >
                            <Ban className="w-3 h-3" />
                          </button>
                        )}
                        {status !== 'running' && (
                          <button
                            onClick={() => removeJob(j.id)}
                            className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 rounded transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
