import { useEffect } from 'react';
import { Check, Plus, Star, AlertCircle, CheckCircle2 } from 'lucide-react';
import useIntegrationsStore from '@/stores/useIntegrationsStore';
import useWindowStore from '@/stores/useWindowStore';

// <IntegrationPicker type="github" value={id} onChange={(id) => ...} />
// Pull-down style chip that shows the connected integration of a type and
// lets the user pick a different saved one or open the Connections app.
export default function IntegrationPicker({ type, value, onChange, label, compact = false }) {
  const list = useIntegrationsStore((s) => s.list);
  const loaded = useIntegrationsStore((s) => s.loaded);
  const refresh = useIntegrationsStore((s) => s.refresh);
  const types = useIntegrationsStore((s) => s.types);
  const defaultFor = useIntegrationsStore((s) => s.defaultFor);
  const openWindow = useWindowStore((s) => s.openWindow);

  useEffect(() => { if (!loaded) refresh(); }, [loaded, refresh]);

  const options = list.filter((i) => i.type === type);
  const fallback = defaultFor(type);
  const selected = options.find((o) => o.id === value) || fallback;
  const typeMeta = types[type];

  if (!loaded) return <div className="h-7 w-32 rounded-md bg-white/[0.04] animate-pulse" />;

  if (options.length === 0) {
    return (
      <button
        onClick={() => openWindow('connections')}
        className="h-7 px-2.5 rounded-md text-[11px] flex items-center gap-1.5 border border-dashed hover:bg-white/[0.04]"
        style={{ borderColor: 'var(--surface-border-active)', color: 'var(--text-on-surface)' }}
      >
        <Plus className="w-3 h-3" />
        Connect {typeMeta?.name || type}
      </button>
    );
  }

  if (compact) {
    return (
      <select
        value={selected?.id || ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-7 px-2 rounded-md text-[11px] bg-white/[0.04] border outline-none"
        style={{ borderColor: 'var(--surface-border)', color: 'var(--text-on-surface)' }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} {o.is_default ? '★' : ''}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-[11px] opacity-60">{label}</span>}
      <select
        value={selected?.id || ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="h-7 px-2 rounded-md text-[11px] bg-white/[0.04] border outline-none flex-1"
        style={{ borderColor: 'var(--surface-border)', color: 'var(--text-on-surface)' }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} {o.is_default ? '(default)' : ''}
          </option>
        ))}
      </select>
      {selected?.status === 'connected' ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" title="Connected" />
      ) : selected?.status === 'error' ? (
        <AlertCircle className="w-3.5 h-3.5 text-rose-400" title="Connection error" />
      ) : null}
      <button
        onClick={() => openWindow('connections')}
        className="opacity-50 hover:opacity-100 p-0.5"
        title="Manage connections"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
