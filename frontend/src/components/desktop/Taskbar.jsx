import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { LogOut, LayoutGrid, ChevronUp, Search } from 'lucide-react';
import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import useAuthStore from '@/stores/useAuthStore';
import useCommandStore from '@/stores/useCommandStore';
import APP_REGISTRY from '@/lib/appRegistry';
import useIsMobile from '@/hooks/useIsMobile';
import ContextBreadcrumb from './ContextBreadcrumb';
import WorkspaceSwitcher from './WorkspaceSwitcher';

export default function Taskbar() {
  const windows = useWindowStore((s) => s.windows);
  const activeWindowId = useWindowStore((s) => s.activeWindowId);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const toggleLauncher = useDesktopStore((s) => s.toggleLauncher);
  const clockFormat = useDesktopStore((s) => s.clockFormat);
  const openPalette = useCommandStore((s) => s.openPalette);
  const admin = useAuthStore((s) => s.admin);
  const logout = useAuthStore((s) => s.logout);
  const isMobile = useIsMobile();

  const [time, setTime] = useState(new Date());
  const [showMobileWindows, setShowMobileWindows] = useState(false);

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
    if (isMobile) setShowMobileWindows(false);
  };

  const openWindowsList = Object.values(windows);
  const openCount = openWindowsList.length;

  return (
    <>
      {/* Mobile: floating window switcher popup */}
      {isMobile && showMobileWindows && openCount > 0 && (
        <div
          className="fixed bottom-12 left-0 right-0 z-[9998] p-2 animate-slide-up"
          onClick={() => setShowMobileWindows(false)}
        >
          <div
            className="rounded-xl border backdrop-blur-xl overflow-hidden mx-1"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-2 space-y-0.5 max-h-60 overflow-y-auto">
              {openWindowsList.map((win) => {
                const appDef = APP_REGISTRY[win.appId];
                const Icon = appDef?.icon;
                const isActive = activeWindowId === win.id && !win.isMinimized;
                return (
                  <button
                    key={win.id}
                    onClick={() => handleWindowClick(win.id)}
                    className={`w-full h-10 px-3 rounded-lg flex items-center gap-3 text-xs transition-all duration-150 ${
                      isActive
                        ? 'bg-primary/15 text-foreground'
                        : 'text-muted-foreground hover:bg-white/[0.05]'
                    }`}
                  >
                    {Icon && <Icon className={`w-4 h-4 shrink-0 ${isActive ? (appDef.iconColor || '') : ''}`} />}
                    <span className="truncate flex-1 text-left">{win.title}</span>
                    {win.isMinimized && <span className="text-[10px] opacity-40">minimized</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Taskbar */}
      <div className="fixed bottom-0 left-0 right-0 h-11 z-[9999] backdrop-blur-2xl border-t flex items-center px-2 gap-1" style={{ background: 'var(--taskbar-bg)', borderColor: 'var(--surface-border-active)' }}>
        {/* VPC launcher button */}
        <button
          onClick={toggleLauncher}
          className="h-8 px-3.5 rounded-lg bg-primary/90 text-primary-foreground text-xs font-bold flex items-center gap-1.5 hover:bg-primary transition-colors shrink-0"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">VPC</span>
        </button>

        {/* Command Palette trigger */}
        <button
          onClick={openPalette}
          className="hidden sm:flex h-8 px-2.5 rounded-lg items-center gap-2 text-xs text-muted-foreground hover:bg-white/[0.05] border transition-colors shrink-0"
          style={{ borderColor: 'var(--surface-border)' }}
          title="Command Palette (Ctrl+K)"
        >
          <Search className="w-3.5 h-3.5 opacity-60" />
          <span className="hidden md:inline opacity-70">Search</span>
          <kbd className="hidden md:inline-flex items-center font-mono text-[9px] px-1 py-0.5 rounded border opacity-50" style={{ borderColor: 'var(--surface-border-active)' }}>
            Ctrl K
          </kbd>
        </button>

        <div className="w-px h-5 mx-1 hidden sm:block" style={{ background: 'var(--surface-border)' }} />

        {/* Desktop: open window tabs */}
        {!isMobile && (
          <div className="flex-1 flex items-center gap-0.5 overflow-x-auto">
            {openWindowsList.map((win) => {
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
        )}

        {/* Mobile: open windows indicator button */}
        {isMobile && (
          <div className="flex-1 flex items-center">
            {openCount > 0 && (
              <button
                onClick={() => setShowMobileWindows(!showMobileWindows)}
                className="h-8 px-3 rounded-lg flex items-center gap-2 text-xs text-muted-foreground hover:bg-white/[0.05] transition-colors"
              >
                <ChevronUp className={`w-3.5 h-3.5 transition-transform ${showMobileWindows ? 'rotate-180' : ''}`} />
                <span>{openCount} open</span>
              </button>
            )}
          </div>
        )}

        <ContextBreadcrumb />

        <WorkspaceSwitcher />

        <div className="w-px h-5 mx-1" style={{ background: 'var(--surface-border)' }} />

        {/* Right: admin info + clock + logout */}
        <div className="flex items-center gap-2 sm:gap-3 text-xs text-muted-foreground shrink-0">
          <span className="font-medium text-foreground/70 hidden sm:inline">{admin?.username}</span>
          <div className="text-right">
            <div className="font-mono text-[11px] text-foreground/60 leading-none">{format(time, clockFormat === '12h' ? 'h:mm a' : 'HH:mm')}</div>
            <div className="font-mono text-[9px] text-foreground/30 leading-none mt-0.5">{format(time, 'dd MMM')}</div>
          </div>
          <button
            onClick={logout}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/10 hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
