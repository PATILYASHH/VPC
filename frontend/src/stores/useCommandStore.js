import { create } from 'zustand';

const useCommandStore = create((set) => ({
  open: false,
  query: '',
  customCommands: [],

  openPalette: () => set({ open: true, query: '' }),
  closePalette: () => set({ open: false, query: '' }),
  togglePalette: () => set((s) => ({ open: !s.open, query: '' })),
  setQuery: (query) => set({ query }),

  registerCommand: (cmd) =>
    set((s) => ({ customCommands: [...s.customCommands.filter((c) => c.id !== cmd.id), cmd] })),
  unregisterCommand: (id) =>
    set((s) => ({ customCommands: s.customCommands.filter((c) => c.id !== id) })),
}));

export default useCommandStore;
