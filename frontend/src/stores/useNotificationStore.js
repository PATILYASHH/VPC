import { create } from 'zustand';

const STORAGE_KEY = 'vpc-notifications';
const MAX_HISTORY = 50;

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw).slice(0, MAX_HISTORY);
  } catch { return []; }
}

function saveHistory(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {}
}

let nextId = 1;

const useNotificationStore = create((set, get) => ({
  items: loadHistory(),
  open: false,

  togglePanel: () => set((s) => ({ open: !s.open })),
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),

  // Add a notification. category: deploy | backup | error | system | pr | ai | info
  notify: ({ title, message, category = 'info', level = 'info', actions = [], persistent = false, ttl }) => {
    const item = {
      id: `n-${++nextId}-${Date.now()}`,
      title,
      message: message || '',
      category,
      level, // info | success | warning | error
      actions, // [{ label, onClick }]
      ts: Date.now(),
      read: false,
      persistent,
    };
    set((s) => {
      const items = [item, ...s.items].slice(0, MAX_HISTORY);
      saveHistory(items);
      return { items };
    });
    if (!persistent && ttl !== 0) {
      const ms = ttl ?? (level === 'error' ? 8000 : 4000);
      setTimeout(() => {
        const cur = get().items.find((i) => i.id === item.id);
        if (cur && !cur.read) get().markRead(item.id);
      }, ms);
    }
    return item.id;
  },

  markRead: (id) => set((s) => {
    const items = s.items.map((i) => i.id === id ? { ...i, read: true } : i);
    saveHistory(items);
    return { items };
  }),

  markAllRead: () => set((s) => {
    const items = s.items.map((i) => ({ ...i, read: true }));
    saveHistory(items);
    return { items };
  }),

  dismiss: (id) => set((s) => {
    const items = s.items.filter((i) => i.id !== id);
    saveHistory(items);
    return { items };
  }),

  clearAll: () => {
    saveHistory([]);
    set({ items: [] });
  },
}));

export const notify = (opts) => useNotificationStore.getState().notify(opts);

export default useNotificationStore;
