import { useEffect } from 'react';
import { Plug, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import useIntegrationsStore from '@/stores/useIntegrationsStore';
import useWindowStore from '@/stores/useWindowStore';
import WidgetShell from './WidgetShell';

export default function ConnectionsWidget({ onRemove }) {
  const list = useIntegrationsStore((s) => s.list);
  const types = useIntegrationsStore((s) => s.types);
  const loaded = useIntegrationsStore((s) => s.loaded);
  const refresh = useIntegrationsStore((s) => s.refresh);
  const openWindow = useWindowStore((s) => s.openWindow);

  useEffect(() => { if (!loaded) refresh(); }, [loaded, refresh]);

  const connected = list.filter((i) => i.status === 'connected');
  const errored = list.filter((i) => i.status === 'error');

  return (
    <WidgetShell
      title="Connections"
      icon={Plug}
      onRemove={onRemove}
      action={
        <button
          onClick={() => openWindow('connections')}
          className="opacity-50 hover:opacity-100"
          title="Manage"
        >
          <Plus className="w-3 h-3" />
        </button>
      }
    >
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span style={{ color: 'var(--text-on-surface)' }}>{connected.length}</span>
            <span className="opacity-50">connected</span>
          </div>
          {errored.length > 0 && (
            <div className="flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-rose-400" />
              <span style={{ color: 'var(--text-on-surface)' }}>{errored.length}</span>
              <span className="opacity-50">error</span>
            </div>
          )}
          <div className="opacity-40 ml-auto">{Object.keys(types).length} services</div>
        </div>
        <div className="space-y-1">
          {list.slice(0, 5).map((i) => (
            <button
              key={i.id}
              onClick={() => openWindow('connections')}
              className="w-full flex items-center gap-2 h-7 px-1.5 rounded hover:bg-white/[0.04] text-left"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                i.status === 'connected' ? 'bg-emerald-400'
                : i.status === 'error' ? 'bg-rose-400'
                : 'bg-white/30'
              }`} />
              <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-on-surface)' }}>{i.name}</span>
              <span className="text-[9px] opacity-40">{types[i.type]?.name || i.type}</span>
            </button>
          ))}
          {list.length === 0 && (
            <button
              onClick={() => openWindow('connections')}
              className="w-full text-[11px] opacity-60 hover:opacity-100 py-2 text-center"
            >
              Connect your first service →
            </button>
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
