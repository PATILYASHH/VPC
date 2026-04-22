import { useEffect } from 'react';
import { Plug, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import useIntegrationsStore from '@/stores/useIntegrationsStore';
import useWindowStore from '@/stores/useWindowStore';

// Wrap a feature that needs an integration. When none is connected the user
// gets a one-click CTA to the Connections app instead of being asked for tokens.
//
//   <RequireIntegration type="github">
//     {(integration) => <RepoBrowser integration={integration} />}
//   </RequireIntegration>
export default function RequireIntegration({ type, children, fallback, app, resourceKind, resourceId }) {
  const loaded = useIntegrationsStore((s) => s.loaded);
  const refresh = useIntegrationsStore((s) => s.refresh);
  const defaultFor = useIntegrationsStore((s) => s.defaultFor);
  const types = useIntegrationsStore((s) => s.types);
  const openWindow = useWindowStore((s) => s.openWindow);

  useEffect(() => { if (!loaded) refresh(); }, [loaded, refresh]);

  if (!loaded) {
    return <div className="p-6 opacity-50 text-sm">Loading connections…</div>;
  }

  const integration = defaultFor(type);
  const meta = types[type] || { name: type };

  if (!integration) {
    if (fallback) return fallback;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center">
          <Plug className="w-6 h-6 opacity-50" />
        </div>
        <div className="text-center max-w-sm">
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-on-surface)' }}>
            Connect {meta.name}
          </div>
          <div className="text-xs opacity-60">
            {meta.description || `This feature uses your ${meta.name} account. Connect once and every app reuses it.`}
          </div>
        </div>
        <button
          onClick={() => openWindow('connections')}
          className="h-8 px-3 rounded-md bg-primary/85 hover:bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5"
        >
          Open Connections
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  if (integration.status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-rose-400" />
        </div>
        <div className="text-center max-w-sm">
          <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-on-surface)' }}>
            {meta.name} connection error
          </div>
          <div className="text-xs opacity-60">
            Re-test or update the integration in Connections.
          </div>
        </div>
        <button
          onClick={() => openWindow('connections')}
          className="h-8 px-3 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium flex items-center gap-1.5"
          style={{ color: 'var(--text-on-surface)' }}
        >
          Open Connections
        </button>
      </div>
    );
  }

  return typeof children === 'function' ? children(integration) : children;
}
