import { create } from 'zustand';

const STORAGE_KEY = 'vpc-dashboard';

const DEFAULT_LAYOUT = [
  'system-metrics',
  'job-queue',
  'notifications',
  'recent-context',
  'quick-apps',
];

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pinned: state.pinned }));
  } catch {}
}

const initial = load();

const useDashboardStore = create((set, get) => ({
  pinned: initial?.pinned ?? DEFAULT_LAYOUT,

  pinWidget: (id) => {
    set((s) => s.pinned.includes(id) ? s : { pinned: [...s.pinned, id] });
    persist(get());
  },
  unpinWidget: (id) => {
    set((s) => ({ pinned: s.pinned.filter((w) => w !== id) }));
    persist(get());
  },
  reset: () => {
    set({ pinned: DEFAULT_LAYOUT });
    persist(get());
  },
}));

export default useDashboardStore;
