import useWindowStore from '@/stores/useWindowStore';
import APP_REGISTRY from '@/lib/appRegistry';
import { Minus, Square, X, Maximize2, ArrowLeft } from 'lucide-react';
import useIsMobile from '@/hooks/useIsMobile';

export default function WindowTitleBar({ windowId, isActive }) {
  const win = useWindowStore((s) => s.windows[windowId]);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const isMobile = useIsMobile();

  if (!win) return null;
  const appDef = APP_REGISTRY[win.appId];
  const Icon = appDef?.icon;

  // Mobile title bar: back button + title + close
  if (isMobile) {
    return (
      <div
        className="h-11 flex items-center justify-between px-2 select-none border-b"
        style={{
          background: 'var(--titlebar-bg)',
          borderColor: 'var(--surface-border-active)',
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); minimizeWindow(windowId); }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-white/[0.06] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 min-w-0 flex-1 justify-center">
          {Icon && <Icon className={`w-4 h-4 shrink-0 ${appDef.iconColor || 'text-muted-foreground'}`} />}
          <span className="text-xs font-medium truncate text-foreground/90">
            {win.title}
          </span>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); closeWindow(windowId); }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-500/15 hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Desktop title bar
  return (
    <div
      className="window-drag-handle h-10 flex items-center justify-between px-3 select-none cursor-default border-b transition-colors duration-150"
      style={{
        background: isActive ? 'var(--titlebar-bg)' : 'var(--titlebar-inactive)',
        borderColor: isActive ? 'var(--surface-border-active)' : 'var(--surface-border)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? (appDef.iconColor || 'text-muted-foreground') : 'text-muted-foreground/60'}`} />}
        <span className={`text-xs font-medium truncate ${isActive ? 'text-foreground/90' : 'text-foreground/50'}`}>
          {win.title}
        </span>
        {appDef?.description && isActive && (
          <span className="text-[10px] text-muted-foreground/40 truncate hidden sm:inline">
            {appDef.description}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 ml-2">
        <button
          onClick={(e) => { e.stopPropagation(); minimizeWindow(windowId); }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/60 hover:bg-yellow-500/15 hover:text-yellow-400 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); toggleMaximize(windowId); }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/60 hover:bg-green-500/15 hover:text-green-400 transition-colors"
        >
          {win.isMaximized ? <Square className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); closeWindow(windowId); }}
          className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground/60 hover:bg-red-500/15 hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
