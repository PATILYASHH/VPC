import { useEffect, useRef } from 'react';
import { Bell, Check, X, Trash2, AlertTriangle, CheckCircle2, Info, AlertCircle, Rocket, Database, GitMerge, Bot, Zap } from 'lucide-react';
import { format } from 'date-fns';
import useNotificationStore from '@/stores/useNotificationStore';

const CATEGORY_ICONS = {
  deploy: Rocket,
  backup: Database,
  error: AlertCircle,
  system: Zap,
  pr: GitMerge,
  ai: Bot,
  info: Info,
};

const LEVEL_STYLES = {
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  success: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  error: { icon: AlertCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
};

function relTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return format(ts, 'MMM d, HH:mm');
}

export default function NotificationCenter() {
  const open = useNotificationStore((s) => s.open);
  const items = useNotificationStore((s) => s.items);
  const closePanel = useNotificationStore((s) => s.closePanel);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closePanel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[99998]" onClick={closePanel}>
      <div
        ref={panelRef}
        className="absolute right-2 bottom-14 w-[380px] max-h-[70vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col animate-slide-up"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-12 border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 opacity-70" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Notifications</span>
            {items.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/[0.06] opacity-60">{items.length}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={markAllRead}
              className="h-7 px-2 rounded-md text-[10px] hover:bg-white/[0.06] opacity-70 hover:opacity-100 flex items-center gap-1"
              title="Mark all read"
            >
              <Check className="w-3 h-3" /> Read
            </button>
            <button
              onClick={clearAll}
              className="h-7 px-2 rounded-md text-[10px] hover:bg-rose-500/10 hover:text-rose-400 opacity-70 hover:opacity-100 flex items-center gap-1"
              title="Clear all"
            >
              <Trash2 className="w-3 h-3" /> Clear
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 opacity-40 gap-2">
              <Bell className="w-8 h-8" />
              <span className="text-xs">No notifications</span>
            </div>
          ) : (
            items.map((n) => {
              const lvl = LEVEL_STYLES[n.level] || LEVEL_STYLES.info;
              const CatIcon = CATEGORY_ICONS[n.category] || Info;
              return (
                <div
                  key={n.id}
                  className={`group relative px-3 py-2.5 border-b transition-colors hover:bg-white/[0.02] ${n.read ? 'opacity-60' : ''}`}
                  style={{ borderColor: 'var(--surface-border)' }}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${lvl.bg}`}>
                      <CatIcon className={`w-3.5 h-3.5 ${lvl.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-on-surface)' }}>
                          {n.title}
                        </span>
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
                      </div>
                      {n.message && (
                        <div className="text-[11px] opacity-60 mt-0.5 line-clamp-2">{n.message}</div>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9px] opacity-40">{relTime(n.ts)}</span>
                        <span className="text-[9px] opacity-40 capitalize">· {n.category}</span>
                        {n.actions?.map((a, i) => (
                          <button
                            key={i}
                            onClick={() => { a.onClick(); dismiss(n.id); }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12]"
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => dismiss(n.id)}
                      className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 rounded transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
