import { create } from 'zustand';
import useWindowStore from './useWindowStore';

const STORAGE_KEY = 'vpc-workspaces';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profiles: state.profiles,
      activeId: state.activeId,
    }));
  } catch {}
}

const initial = load() || { profiles: [], activeId: null };

const useWorkspaceStore = create((set, get) => ({
  profiles: initial.profiles, // [{ id, name, icon, snapshot: { windows, activeWindowId, nextZIndex } }]
  activeId: initial.activeId,

  saveCurrent: (name) => {
    const winState = useWindowStore.getState();
    const snapshot = {
      windows: JSON.parse(JSON.stringify(winState.windows)),
      activeWindowId: winState.activeWindowId,
      nextZIndex: winState.nextZIndex,
    };
    const id = `ws-${Date.now()}`;
    const profile = { id, name: name || `Workspace ${get().profiles.length + 1}`, snapshot, createdAt: Date.now() };
    set((s) => ({ profiles: [...s.profiles, profile], activeId: id }));
    persist(get());
    return id;
  },

  overwrite: (id) => {
    const winState = useWindowStore.getState();
    const snapshot = {
      windows: JSON.parse(JSON.stringify(winState.windows)),
      activeWindowId: winState.activeWindowId,
      nextZIndex: winState.nextZIndex,
    };
    set((s) => ({
      profiles: s.profiles.map((p) => p.id === id ? { ...p, snapshot, updatedAt: Date.now() } : p),
      activeId: id,
    }));
    persist(get());
  },

  rename: (id, name) => {
    set((s) => ({ profiles: s.profiles.map((p) => p.id === id ? { ...p, name } : p) }));
    persist(get());
  },

  remove: (id) => {
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }));
    persist(get());
  },

  load: (id) => {
    const profile = get().profiles.find((p) => p.id === id);
    if (!profile) return;
    const winState = useWindowStore.getState();
    // Replace store contents
    useWindowStore.setState({
      windows: JSON.parse(JSON.stringify(profile.snapshot.windows)),
      activeWindowId: profile.snapshot.activeWindowId,
      nextZIndex: profile.snapshot.nextZIndex,
    });
    set({ activeId: id });
    persist(get());
  },

  loadByIndex: (idx) => {
    const profile = get().profiles[idx];
    if (profile) get().load(profile.id);
  },
}));

export default useWorkspaceStore;
