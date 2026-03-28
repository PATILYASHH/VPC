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
    <div className="fixed bottom-0 left-0 right-0 h-12 z-[9999] bg-[#0d1117]/90 backdrop-blur-xl border-t border-white/[0.06] flex items-center px-2 gap-1">
      {/* VPC launcher button */}
      <button
        onClick={toggleLauncher}
        className="h-8 px-3.5 rounded-lg bg-primary/90 text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary transition-colors shrink-0"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        VPC
      </button>

      <div className="w-px h-5 bg-white/[0.08] mx-1" />

      {/* Open window tabs */}
      <div className="flex-1 flex items-center gap-0.5 overflow-x-auto">
        {Object.values(windows).map((win) => {
          const appDef = APP_REGISTRY[win.appId];
          const Icon = appDef?.icon;
          const isActive = activeWindowId === win.id;

          if (win.isMinimized) {
            return (
              <button
                key={win.id}
                onClick={() => handleWindowClick(win.id)}
                title={win.title}
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-150 bg-white/[0.04] border border-white/[0.06] text-muted-foreground hover:bg-white/[0.08]"
              >
                {Icon && <Icon className={`w-3.5 h-3.5 ${appDef.iconColor || ''}`} />}
              </button>
            );
          }

          return (
            <button
              key={win.id}
              onClick={() => handleWindowClick(win.id)}
              className={`h-8 px-3 rounded-lg flex items-center gap-2 text-xs shrink-0 transition-all duration-150 ${
                isActive
                  ? 'bg-white/[0.1] text-foreground border border-white/[0.1]'
                  : 'text-muted-foreground hover:bg-white/[0.05] border border-transparent'
              }`}
            >
              {Icon && <Icon className={`w-3.5 h-3.5 ${isActive ? (appDef.iconColor || '') : ''}`} />}
              <span className="truncate max-w-[120px]">{win.title}</span>
            </button>
          );
        })}
      </div>

      <div className="w-px h-5 bg-white/[0.08] mx-1" />

      {/* Right: admin info + clock + logout */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
        <span className="font-medium text-foreground/70">{admin?.username}</span>
        <span className="font-mono text-[11px] text-foreground/50">{format(time, 'HH:mm')}</span>
        <button
          onClick={logout}
          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 hover:text-red-400 transition-colors"
          title="Logout"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
