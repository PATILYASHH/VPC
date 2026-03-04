import { create } from 'zustand';

const useDesktopStore = create((set) => ({
  theme: 'dark',
  launcherOpen: false,

  setTheme: (theme) => set({ theme }),
  toggleLauncher: () => set((s) => ({ launcherOpen: !s.launcherOpen })),
  closeLauncher: () => set({ launcherOpen: false }),
}));

export default useDesktopStore;
