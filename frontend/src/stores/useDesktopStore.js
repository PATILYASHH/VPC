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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: state.theme }));
  } catch {}
}

// ─── Theme application ──────────────────────────────────────

const LIGHT_OVERRIDES_ID = 'vpc-theme-overrides';

function isLightTheme(themeId) {
  return themeId === 'light';
}

function applyThemeToDOM(themeId) {
  const html = document.documentElement;

  // Remove all theme classes
  html.className = html.className.replace(/\b(dark|theme-\w+)\b/g, '').trim();

  // Add new theme class
  if (themeId === 'light') {
    html.classList.add('theme-light');
  } else if (themeId === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.add('dark'); // keep dark base for Tailwind
    html.classList.add(`theme-${themeId}`);
  }

  // Inject or remove light-mode style overrides
  let styleEl = document.getElementById(LIGHT_OVERRIDES_ID);

  if (isLightTheme(themeId)) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = LIGHT_OVERRIDES_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      /* VPC Light Theme — runtime overrides for white-alpha patterns */

      /* Borders: white-alpha → black-alpha */
      [class*="border-white\\/"] {
        border-color: rgba(0,0,0,0.1) !important;
      }

      /* Backgrounds: white-alpha overlays → black-alpha */
      [class*="bg-white\\/[0.0"] {
        background-color: rgba(0,0,0,0.025) !important;
      }
      [class*="bg-white\\/[0.1"] {
        background-color: rgba(0,0,0,0.06) !important;
      }

      /* Ring */
      [class*="ring-white\\/"] {
        --tw-ring-color: rgba(0,0,0,0.1) !important;
      }

      /* Shadow */
      [class*="shadow-2xl"] {
        --tw-shadow: 0 10px 40px rgba(0,0,0,0.1) !important;
        --tw-shadow-colored: 0 10px 40px var(--tw-shadow-color) !important;
        box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow) !important;
      }
      [class*="shadow-xl"] {
        --tw-shadow: 0 6px 20px rgba(0,0,0,0.06) !important;
        --tw-shadow-colored: 0 6px 20px var(--tw-shadow-color) !important;
        box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow) !important;
      }
      [class*="shadow-black\\/"] {
        --tw-shadow-color: rgba(0,0,0,0.08) !important;
      }

      /* Text opacity */
      [class*="text-foreground\\/"] {
        color: hsl(var(--foreground)) !important;
      }
      [class*="text-muted-foreground\\/"] {
        color: hsl(var(--muted-foreground)) !important;
      }

      /* Fix icon backgrounds — keep their alpha but on light surfaces */
      [class*="bg-violet-500/1"], [class*="bg-emerald-500/1"],
      [class*="bg-blue-500/1"], [class*="bg-cyan-500/1"],
      [class*="bg-orange-500/1"], [class*="bg-green-500/1"],
      [class*="bg-yellow-500/1"], [class*="bg-pink-500/1"],
      [class*="bg-purple-500/1"], [class*="bg-amber-500/1"],
      [class*="bg-teal-500/1"], [class*="bg-indigo-500/1"],
      [class*="bg-slate-500/1"], [class*="bg-zinc-500/1"],
      [class*="bg-red-500/1"] {
        /* These are fine — colored backgrounds with alpha work on both themes */
      }

      /* Scrollbar */
      ::-webkit-scrollbar-thumb {
        background: rgba(0,0,0,0.15) !important;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(0,0,0,0.25) !important;
      }

      /* Login page */
      body {
        color-scheme: light;
      }
    `;
  } else {
    if (styleEl) {
      styleEl.remove();
    }
  }
}

// Apply saved theme on load
const saved = loadPrefs();
const initialTheme = saved.theme || 'dark';
if (typeof document !== 'undefined') {
  applyThemeToDOM(initialTheme);
}

const useDesktopStore = create((set) => ({
  theme: initialTheme,
  launcherOpen: false,

  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      applyThemeToDOM(theme);
    }
    set({ theme });
  },
  toggleLauncher: () => set((s) => ({ launcherOpen: !s.launcherOpen })),
  closeLauncher: () => set({ launcherOpen: false }),
}));

useDesktopStore.subscribe((state) => savePrefs(state));

export default useDesktopStore;
