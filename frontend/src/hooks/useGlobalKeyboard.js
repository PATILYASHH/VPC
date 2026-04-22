import { useEffect } from 'react';
import useCommandStore from '@/stores/useCommandStore';
import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import useWorkspaceStore from '@/stores/useWorkspaceStore';
import useNotificationStore from '@/stores/useNotificationStore';

export default function useGlobalKeyboard() {
  const togglePalette = useCommandStore((s) => s.togglePalette);
  const openWindow = useWindowStore((s) => s.openWindow);
  const windows = useWindowStore((s) => s.windows);
  const minimizeWindow = useWindowStore((s) => s.minimizeWindow);
  const toggleLauncher = useDesktopStore((s) => s.toggleLauncher);

  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;

      // Cmd/Ctrl+K — command palette (works even when typing)
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }

      if (isTyping) return;

      // Cmd/Ctrl+T — terminal
      if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        openWindow('developer-terminal');
        return;
      }
      // Cmd/Ctrl+D — DB
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        openWindow('db');
        return;
      }
      // Cmd/Ctrl+G — Gallery
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        openWindow('gallery');
        return;
      }
      // Cmd/Ctrl+, — Settings
      if (mod && e.key === ',') {
        e.preventDefault();
        openWindow('system-settings');
        return;
      }
      // Cmd/Ctrl+Space — App launcher
      if (mod && e.code === 'Space') {
        e.preventDefault();
        toggleLauncher();
        return;
      }
      // Cmd/Ctrl+` — minimize all
      if (mod && e.key === '`') {
        e.preventDefault();
        Object.values(windows).forEach((w) => !w.isMinimized && minimizeWindow(w.id));
        return;
      }
      // Cmd/Ctrl+Shift+S — save current workspace
      if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const name = window.prompt('Save workspace as:');
        if (name?.trim()) {
          useWorkspaceStore.getState().saveCurrent(name.trim());
          useNotificationStore.getState().notify({ title: `Workspace saved`, message: name.trim(), category: 'system', level: 'success' });
        }
        return;
      }
      // Cmd/Ctrl+1..9 — load workspace by index
      if (mod && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        const profiles = useWorkspaceStore.getState().profiles;
        if (profiles[idx]) {
          e.preventDefault();
          useWorkspaceStore.getState().loadByIndex(idx);
          useNotificationStore.getState().notify({ title: `Loaded workspace`, message: profiles[idx].name, category: 'system', level: 'info' });
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePalette, openWindow, windows, minimizeWindow, toggleLauncher]);
}
