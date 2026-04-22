import { useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import WIDGET_REGISTRY from '@/lib/widgetRegistry';
import useDashboardStore from '@/stores/useDashboardStore';

export default function Dashboard() {
  const pinned = useDashboardStore((s) => s.pinned);
  const pinWidget = useDashboardStore((s) => s.pinWidget);
  const unpinWidget = useDashboardStore((s) => s.unpinWidget);
  const reset = useDashboardStore((s) => s.reset);

  const [pickerOpen, setPickerOpen] = useState(false);

  const available = Object.values(WIDGET_REGISTRY).filter((w) => !pinned.includes(w.id));

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--surface-0)' }}>
      {/* Toolbar */}
      <div className="h-10 px-3 flex items-center gap-2 border-b shrink-0" style={{ borderColor: 'var(--surface-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--text-on-surface)' }}>Dashboard</span>
        <span className="text-[10px] opacity-50">{pinned.length} widgets</span>
        <div className="flex-1" />
        <button
          onClick={() => setPickerOpen(true)}
          className="h-7 px-2 rounded-md text-[11px] flex items-center gap-1 hover:bg-white/[0.06] border"
          style={{ borderColor: 'var(--surface-border)' }}
        >
          <Plus className="w-3 h-3" /> Add widget
        </button>
        <button
          onClick={reset}
          className="h-7 px-2 rounded-md text-[11px] flex items-center gap-1 hover:bg-white/[0.06] opacity-70"
          title="Reset to default layout"
        >
          <RefreshCw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-3">
        {pinned.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-50 gap-2">
            <span className="text-sm">No widgets pinned</span>
            <button
              onClick={() => setPickerOpen(true)}
              className="text-xs px-3 py-1.5 rounded bg-primary/80 text-primary-foreground hover:bg-primary"
            >
              Add your first widget
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 auto-rows-[160px]">
            {pinned.map((wId) => {
              const widget = WIDGET_REGISTRY[wId];
              if (!widget) return null;
              const Render = widget.render;
              const w = widget.defaultSize?.w || 1;
              const h = widget.defaultSize?.h || 1;
              return (
                <div key={wId} style={{ gridColumn: `span ${Math.min(w, 4)}`, gridRow: `span ${h}` }}>
                  <Render onRemove={() => unpinWidget(wId)} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Picker modal */}
      {pickerOpen && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-11 border-b" style={{ borderColor: 'var(--surface-border)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Add Widget</span>
              <button onClick={() => setPickerOpen(false)} className="p-1 rounded hover:bg-white/[0.06]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {available.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs opacity-50">All widgets pinned</div>
              ) : (
                available.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => { pinWidget(w.id); setPickerOpen(false); }}
                    className="w-full px-3 h-12 flex items-center gap-3 hover:bg-white/[0.05] text-left"
                  >
                    <div className="w-8 h-8 rounded-md bg-white/[0.04] flex items-center justify-center">
                      <Plus className="w-3.5 h-3.5 opacity-60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium" style={{ color: 'var(--text-on-surface)' }}>{w.title}</div>
                      <div className="text-[10px] opacity-50 truncate">{w.description}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
