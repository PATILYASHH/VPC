import { Bell } from 'lucide-react';
import useNotificationStore from '@/stores/useNotificationStore';
import WidgetShell from './WidgetShell';

const LEVEL = {
  info: 'text-blue-400',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-rose-400',
};

export default function NotificationsWidget({ onRemove }) {
  const items = useNotificationStore((s) => s.items).slice(0, 12);

  return (
    <WidgetShell title="Activity" icon={Bell} onRemove={onRemove}>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full opacity-40 gap-1.5">
          <Bell className="w-5 h-5" />
          <span className="text-[10px]">All clear</span>
        </div>
      ) : (
        <div>
          {items.map((n) => (
            <div key={n.id} className="px-3 py-2 border-b" style={{ borderColor: 'var(--surface-border)' }}>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${LEVEL[n.level] || 'bg-white/40'}`} style={{ background: 'currentColor' }} />
                <span className="text-[11px] font-medium truncate flex-1" style={{ color: 'var(--text-on-surface)' }}>{n.title}</span>
                <span className="text-[9px] opacity-40 capitalize">{n.category}</span>
              </div>
              {n.message && (
                <div className="text-[10px] opacity-50 mt-0.5 line-clamp-1">{n.message}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}
