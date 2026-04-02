import { create } from 'zustand';

const STORAGE_KEY = 'vpc-desktop-prefs';

function loadPrefs() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function savePrefs(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      theme: state.theme,
    }));
  } catch { /* ignore */ }
}

const saved = loadPrefs();

// Apply saved theme class on load
const initialTheme = saved.theme || 'dark';
if (typeof document !== 'undefined' && initialTheme !== 'dark') {
  document.documentElement.classList.add(`theme-${initialTheme}`);
}

const useDesktopStore = create((set) => ({
  theme: initialTheme,
  launcherOpen: false,

  setTheme: (theme) => set({ theme }),
  toggleLauncher: () => set((s) => ({ launcherOpen: !s.launcherOpen })),
  closeLauncher: () => set({ launcherOpen: false }),
}));

useDesktopStore.subscribe((state) => savePrefs(state));

export default useDesktopStore;
