import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { LogOut, LayoutGrid } from 'lucide-react';
import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY from '@/lib/appRegistry';

export default function Taskbar() {
  const windows = useWindowStore((s) => s.windows);
  const activeWindowId = useWindowStore((s) => s.activeWindowId);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const toggleLauncher = useDesktopStore((s) => s.toggleLauncher);
  const admin = useAuthStore((s) => s.admin);
  const logout = useAuthStore((s) => s.logout);

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const handleWindowClick = (winId) => {
    const win = windows[winId];
    if (activeWindowId === winId && !win.isMinimized) {
      minimizeWindow(winId);
    } else {
      focusWindow(winId);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 h-12 z-[9999] bg-card/80 backdrop-blur-md border-t flex items-center px-2">
      {/* Left: VPC launcher button */}
      <button
        onClick={toggleLauncher}
        className="h-8 px-3 rounded bg-primary text-primary-foreground text-sm font-bold flex items-center gap-1.5 hover:bg-primary/90 transition-colors"
      >
        <LayoutGrid className="w-4 h-4" />
        VPC
      </button>

      <div className="w-px h-6 bg-border mx-2" />

      {/* Center: open window tabs */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {Object.values(windows).map((win) => {
          const appDef = APP_REGISTRY[win.appId];
          const Icon = appDef?.icon;
          const isActive = activeWindowId === win.id;

          return (
            <button
              key={win.id}
              onClick={() => handleWindowClick(win.id)}
              className={`h-8 px-3 rounded flex items-center gap-2 text-xs shrink-0 transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50'
              } ${win.isMinimized ? 'opacity-50' : ''}`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              <span className="truncate max-w-[120px]">{win.title}</span>
            </button>
          );
        })}
      </div>

      <div className="w-px h-6 bg-border mx-2" />

      {/* Right: admin info + clock + logout */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{admin?.username}</span>
        <span className="font-mono">{format(time, 'HH:mm')}</span>
        <button
          onClick={logout}
          className="hover:text-destructive transition-colors"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
