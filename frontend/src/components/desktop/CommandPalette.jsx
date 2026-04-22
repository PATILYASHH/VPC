import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ArrowRight, Command, Zap, LayoutGrid, Terminal as TerminalIcon, Settings as SettingsIcon, LogOut, RefreshCw, Maximize2, Palette } from 'lucide-react';
import useCommandStore from '@/stores/useCommandStore';
import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY, { APP_CATEGORIES } from '@/lib/appRegistry';
import { ACCENTS } from '@/stores/useDesktopStore';

function fuzzyScore(query, target) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;
  if (t.includes(q)) return 200;
  // Subsequence match
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 50 : 0;
}

export default function CommandPalette() {
  const open = useCommandStore((s) => s.open);
  const query = useCommandStore((s) => s.query);
  const setQuery = useCommandStore((s) => s.setQuery);
  const closePalette = useCommandStore((s) => s.closePalette);
  const customCommands = useCommandStore((s) => s.customCommands);

  const openWindow = useWindowStore((s) => s.openWindow);
  const windows = useWindowStore((s) => s.windows);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const closeWindow = useWindowStore((s) => s.closeWindow);
  const setTheme = useDesktopStore((s) => s.setTheme);
  const setAccent = useDesktopStore((s) => s.setAccent);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const logout = useAuthStore((s) => s.logout);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Build command list
  const commands = useMemo(() => {
    const cmds = [];

    // Apps
    Object.values(APP_REGISTRY).forEach((app) => {
      if (app.permission && !hasPermission(app.permission)) return;
      cmds.push({
        id: `open-${app.id}`,
        type: 'app',
        section: APP_CATEGORIES[app.category]?.label || 'Apps',
        title: app.title,
        subtitle: app.description,
        keywords: `${app.title} ${app.description} ${app.id} open launch`,
        icon: app.icon,
        iconColor: app.iconColor,
        iconBg: app.iconBg,
        action: () => openWindow(app.id),
      });
    });

    // Open windows — focus / close
    Object.values(windows).forEach((win) => {
      const app = APP_REGISTRY[win.appId];
      if (!app) return;
      cmds.push({
        id: `focus-${win.id}`,
        type: 'window',
        section: 'Open Windows',
        title: `Switch to ${win.title}`,
        subtitle: win.isMinimized ? 'Minimized' : 'Open',
        keywords: `switch focus ${win.title} ${win.appId}`,
        icon: app.icon,
        iconColor: app.iconColor,
        action: () => focusWindow(win.id),
      });
    });

    // System actions
    const sys = [
      { id: 'sys-launcher', title: 'Open App Launcher', subtitle: 'Browse all apps', icon: LayoutGrid, kw: 'launcher all apps grid', fn: () => useDesktopStore.getState().toggleLauncher() },
      { id: 'sys-refresh', title: 'Refresh Page', subtitle: 'Reload the desktop', icon: RefreshCw, kw: 'refresh reload restart', fn: () => window.location.reload() },
      { id: 'sys-fullscreen', title: 'Toggle Fullscreen', subtitle: 'Enter or exit fullscreen', icon: Maximize2, kw: 'fullscreen f11 maximize', fn: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); } },
      { id: 'sys-close-all', title: 'Close All Windows', subtitle: 'Dismiss every open window', icon: Zap, kw: 'close all dismiss windows clear', fn: () => Object.keys(windows).forEach((id) => closeWindow(id)) },
      { id: 'sys-logout', title: 'Logout', subtitle: 'Sign out of VPC', icon: LogOut, kw: 'logout signout exit quit', fn: () => logout() },
    ];
    sys.forEach((s) => cmds.push({
      id: s.id, type: 'action', section: 'System',
      title: s.title, subtitle: s.subtitle, keywords: s.kw,
      icon: s.icon, iconColor: 'text-zinc-400', action: s.fn,
    }));

    // Themes
    ['dark', 'light', 'midnight', 'sunset', 'nord'].forEach((t) => {
      cmds.push({
        id: `theme-${t}`,
        type: 'theme',
        section: 'Themes',
        title: `Switch to ${t.charAt(0).toUpperCase() + t.slice(1)} theme`,
        subtitle: `Apply ${t} color scheme`,
        keywords: `theme ${t} color scheme appearance`,
        icon: Palette,
        iconColor: 'text-pink-400',
        action: () => setTheme(t),
      });
    });

    // Accents
    Object.entries(ACCENTS).forEach(([id, a]) => {
      cmds.push({
        id: `accent-${id}`,
        type: 'accent',
        section: 'Accent Color',
        title: `Accent: ${a.label}`,
        subtitle: `Switch primary color to ${a.label.toLowerCase()}`,
        keywords: `accent color ${a.label} ${id} primary swatch`,
        icon: Palette,
        iconColor: '',
        iconBg: '',
        action: () => setAccent(id),
        swatch: a.swatch,
      });
    });

    // Custom commands registered by apps
    customCommands.forEach((c) => cmds.push(c));

    return cmds;
  }, [windows, customCommands, hasPermission, openWindow, focusWindow, closeWindow, logout, setTheme]);

  // Filter + score
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((c) => ({ ...c, _score: fuzzyScore(query, c.keywords || c.title) }))
      .filter((c) => c._score > 0)
      .sort((a, b) => b._score - a._score);
  }, [commands, query]);

  // Group by section
  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach((c) => {
      const sec = c.section || 'Other';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(c);
    });
    return groups;
  }, [filtered]);

  // Reset active index on query change
  useEffect(() => { setActiveIndex(0); }, [query, open]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[activeIndex];
        if (cmd) {
          cmd.action();
          closePalette();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, activeIndex, closePalette]);

  if (!open) return null;

  let runningIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-start justify-center pt-[12vh] px-4 animate-fade-in"
      onClick={closePalette}
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl overflow-hidden border shadow-2xl animate-scale-in origin-top"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 h-14 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <Search className="w-4 h-4 opacity-50 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps, actions, themes…"
            className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-foreground/30"
            style={{ color: 'var(--text-on-surface)' }}
          />
          <kbd className="hidden sm:flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border opacity-50" style={{ borderColor: 'var(--surface-border-active)' }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm opacity-50">
              No matches for "{query}"
            </div>
          ) : (
            Object.entries(grouped).map(([section, items]) => (
              <div key={section} className="mb-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider opacity-40">
                  {section}
                </div>
                {items.map((cmd) => {
                  runningIdx++;
                  const Icon = cmd.icon;
                  const isActive = runningIdx === activeIndex;
                  const idx = runningIdx;
                  return (
                    <button
                      key={cmd.id}
                      data-cmd-idx={idx}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => { cmd.action(); closePalette(); }}
                      className="w-full flex items-center gap-3 px-3 mx-2 h-10 rounded-lg text-left transition-colors"
                      style={{ background: isActive ? 'var(--surface-hover)' : 'transparent' }}
                    >
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${cmd.iconBg || 'bg-white/[0.04]'}`}>
                        {cmd.swatch ? (
                          <span className="w-3.5 h-3.5 rounded-full ring-1 ring-white/10" style={{ background: cmd.swatch }} />
                        ) : Icon && <Icon className={`w-3.5 h-3.5 ${cmd.iconColor || 'opacity-60'}`} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: 'var(--text-on-surface)' }}>
                          {cmd.title}
                        </div>
                        {cmd.subtitle && (
                          <div className="text-[10px] opacity-50 truncate">{cmd.subtitle}</div>
                        )}
                      </div>
                      {isActive && <ArrowRight className="w-3.5 h-3.5 opacity-40 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 h-9 border-t text-[10px] opacity-40" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--surface-border-active)' }}>↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: 'var(--surface-border-active)' }}>↵</kbd>
              select
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Command className="w-3 h-3" />
            <span>VPC Command Palette</span>
          </div>
        </div>
      </div>
    </div>
  );
}
