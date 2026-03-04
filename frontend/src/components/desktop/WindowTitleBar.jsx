import useWindowStore from '@/stores/useWindowStore';
import APP_REGISTRY from '@/lib/appRegistry';
import { Minus, Square, X } from 'lucide-react';

export default function WindowTitleBar({ windowId, isActive }) {
  const win = useWindowStore((s) => s.windows[windowId]);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);
  const closeWindow = useWindowStore((s) => s.closeWindow);

  if (!win) return null;
  const appDef = APP_REGISTRY[win.appId];
  const Icon = appDef?.icon;

  return (
    <div
      className={`window-drag-handle h-10 flex items-center justify-between px-3 select-none cursor-default border-b ${
        isActive ? 'bg-muted' : 'bg-muted/50'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <span className="text-sm font-medium truncate">{win.title}</span>
      </div>

      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            minimizeWindow(windowId);
          }}
          className="w-7 h-7 rounded flex items-center justify-center hover:bg-yellow-500/20 text-muted-foreground hover:text-yellow-500 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMaximize(windowId);
          }}
          className="w-7 h-7 rounded flex items-center justify-center hover:bg-green-500/20 text-muted-foreground hover:text-green-500 transition-colors"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            closeWindow(windowId);
          }}
          className="w-7 h-7 rounded flex items-center justify-center hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
