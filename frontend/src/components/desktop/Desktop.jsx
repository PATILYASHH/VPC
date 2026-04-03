import { useState, useCallback } from 'react';
import useDesktopStore from '@/stores/useDesktopStore';
import useWindowStore from '@/stores/useWindowStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY from '@/lib/appRegistry';
import WindowManager from './WindowManager';
import Taskbar from './Taskbar';
import AppLauncher from './AppLauncher';
import AppIcon from './AppIcon';
import {
  RefreshCw, Settings, Monitor, LayoutGrid, Palette,
  FolderOpen, Terminal, Info, LogOut, Maximize2,
  Copy, ClipboardPaste, Scissors,
} from 'lucide-react';

export default function Desktop() {
  const launcherOpen = useDesktopStore((s) => s.launcherOpen);
  const toggleLauncher = useDesktopStore((s) => s.toggleLauncher);
  const openWindow = useWindowStore((s) => s.openWindow);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useAuthStore((s) => s.logout);
  const [ctxMenu, setCtxMenu] = useState(null);

  const allAppIds = Object.keys(APP_REGISTRY);
  const appIds = allAppIds.filter((id) => {
    const app = APP_REGISTRY[id];
    if (!app.permission) return true;
    return hasPermission(app.permission);
  });

  const handleContextMenu = useCallback((e) => {
    // Only show on the desktop background, not on windows/icons
    if (e.target.closest('.window-drag-handle') || e.target.closest('[data-window]') || e.target.closest('button')) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeCtx = useCallback(() => setCtxMenu(null), []);

  const ctxAction = (action) => {
    closeCtx();
    switch (action) {
      case 'refresh': window.location.reload(); break;
      case 'copy': document.execCommand('copy'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'paste': navigator.clipboard.readText().then(t => document.execCommand('insertText', false, t)).catch(() => document.execCommand('paste')); break;
      case 'settings': openWindow('system-settings'); break;
      case 'terminal': openWindow('developer-terminal'); break;
      case 'gallery': openWindow('gallery'); break;
      case 'store': openWindow('vpc-store'); break;
      case 'apps': toggleLauncher(); break;
      case 'fullscreen':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
        break;
      case 'about':
        openWindow('vpc-store'); // opens store which shows version info
        break;
      case 'logout': logout(); break;
    }
  };

  return (
    <div
      className="h-screen w-screen overflow-hidden relative"
      style={{ background: 'var(--desktop-bg)' }}
      onContextMenu={handleContextMenu}
      onClick={ctxMenu ? closeCtx : undefined}
    >
      {/* Gradient background */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom right, var(--desktop-gradient-from), var(--desktop-gradient-via), var(--desktop-gradient-to))` }} />
      {/* Subtle dot pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(circle, var(--dot-pattern) 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
      }} />
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-[120px]" style={{ background: 'var(--glow-color)' }} />

      {/* Desktop icon grid */}
      <div className="absolute inset-0 bottom-12 p-6 z-10">
        <div className="flex flex-col flex-wrap gap-2 h-full content-start">
          {appIds.map((appId) => (
            <AppIcon key={appId} appId={appId} />
          ))}
        </div>
      </div>

      {/* Window layer */}
      <div className="absolute inset-0 bottom-12 pointer-events-none z-20">
        <WindowManager />
      </div>

      {/* Taskbar */}
      <Taskbar />

      {/* App launcher */}
      {launcherOpen && <AppLauncher />}

      {/* Right-click context menu */}
      {ctxMenu && (
        <DesktopContextMenu x={ctxMenu.x} y={ctxMenu.y} onAction={ctxAction} onClose={closeCtx} />
      )}
    </div>
  );
}

// ─── Context Menu ────────────────────────────────────────────

function DesktopContextMenu({ x, y, onAction, onClose }) {
  // Adjust position to keep menu on screen
  const menuW = 200, menuH = 200;
  const adjX = x + menuW > window.innerWidth ? x - menuW : x;
  const adjY = y + menuH > window.innerHeight - 48 ? y - menuH : y;

  return (
    <div
      className="fixed z-[99999] animate-scale-in origin-top-left"
      style={{ left: adjX, top: adjY }}
      onClick={e => e.stopPropagation()}
    >
      <div
        className="w-[220px] rounded-xl overflow-hidden py-1.5 backdrop-blur-xl border"
        style={{
          background: 'var(--surface-1)',
          borderColor: 'var(--surface-border-active)',
          boxShadow: '0 12px 40px var(--window-shadow)',
        }}
      >
        <CtxItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => onAction('cut')} />
        <CtxItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => onAction('copy')} />
        <CtxItem icon={ClipboardPaste} label="Paste" shortcut="Ctrl+V" onClick={() => onAction('paste')} />
        <CtxSep />
        <CtxItem icon={RefreshCw} label="Refresh" shortcut="Ctrl+R" onClick={() => onAction('refresh')} />
        <CtxItem icon={Maximize2} label="Toggle Fullscreen" shortcut="F11" onClick={() => onAction('fullscreen')} />
      </div>
    </div>
  );
}

function CtxItem({ icon: Icon, label, shortcut, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-[7px] text-xs transition-colors ${
        danger ? 'text-red-400 hover:bg-red-500/10' : 'hover:bg-[var(--surface-hover)]'
      }`}
      style={{ color: danger ? undefined : 'var(--text-on-surface)' }}
    >
      <Icon className="w-3.5 h-3.5 opacity-60" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] opacity-30">{shortcut}</span>}
    </button>
  );
}

function CtxSep() {
  return <div className="my-1 mx-2 h-px" style={{ background: 'var(--surface-border)' }} />;
}
