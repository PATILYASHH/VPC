import { create } from 'zustand';
import APP_REGISTRY from '@/lib/appRegistry';

let windowCounter = 0;

const useWindowStore = create((set, get) => ({
  windows: {},
  nextZIndex: 10,
  activeWindowId: null,

  openWindow: (appId) => {
    const state = get();
    const appDef = APP_REGISTRY[appId];
    if (!appDef) return;

    // Singleton: if app already open, focus it
    const existing = Object.values(state.windows).find((w) => w.appId === appId);
    if (existing) {
      get().focusWindow(existing.id);
      return;
    }

    // Cascade offset based on number of open windows
    const openCount = Object.keys(state.windows).length;
    const cascadeOffset = (openCount % 8) * 30;
    const windowId = `${appId}-${++windowCounter}`;

    const newWindow = {
      id: windowId,
      appId,
      title: appDef.title,
      x: 80 + cascadeOffset,
      y: 40 + cascadeOffset,
      width: appDef.defaultWidth,
      height: appDef.defaultHeight,
      minWidth: appDef.minWidth,
      minHeight: appDef.minHeight,
      isMinimized: false,
      isMaximized: false,
      zIndex: state.nextZIndex,
      prevBounds: null,
    };

    set({
      windows: { ...state.windows, [windowId]: newWindow },
      nextZIndex: state.nextZIndex + 1,
      activeWindowId: windowId,
    });
  },

  closeWindow: (windowId) => {
    set((state) => {
      const { [windowId]: removed, ...rest } = state.windows;
      const remaining = Object.values(rest);
      const nextActive =
        remaining.length > 0
          ? remaining.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
          : null;
      return {
        windows: rest,
        activeWindowId: state.activeWindowId === windowId ? nextActive : state.activeWindowId,
      };
    });
  },

  focusWindow: (windowId) => {
    set((state) => {
      const win = state.windows[windowId];
      if (!win) return state;

      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...win,
            zIndex: state.nextZIndex,
            isMinimized: false,
          },
        },
        nextZIndex: state.nextZIndex + 1,
        activeWindowId: windowId,
      };
    });
  },

  minimizeWindow: (windowId) => {
    set((state) => {
      const updated = {
        ...state.windows,
        [windowId]: { ...state.windows[windowId], isMinimized: true },
      };
      const visible = Object.values(updated).filter((w) => !w.isMinimized);
      const nextActive =
        visible.length > 0
          ? visible.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
          : null;
      return {
        windows: updated,
        activeWindowId: state.activeWindowId === windowId ? nextActive : state.activeWindowId,
      };
    });
  },

  toggleMaximize: (windowId) => {
    set((state) => {
      const win = state.windows[windowId];
      if (!win) return state;

      if (win.isMaximized) {
        return {
          windows: {
            ...state.windows,
            [windowId]: {
              ...win,
              isMaximized: false,
              x: win.prevBounds.x,
              y: win.prevBounds.y,
              width: win.prevBounds.width,
              height: win.prevBounds.height,
              prevBounds: null,
            },
          },
        };
      }

      const taskbarHeight = 48;
      return {
        windows: {
          ...state.windows,
          [windowId]: {
            ...win,
            isMaximized: true,
            prevBounds: { x: win.x, y: win.y, width: win.width, height: win.height },
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight - taskbarHeight,
          },
        },
      };
    });
  },

  updatePosition: (windowId, pos) => {
    set((state) => ({
      windows: {
        ...state.windows,
        [windowId]: { ...state.windows[windowId], x: pos.x, y: pos.y },
      },
    }));
  },

  updateSize: (windowId, size) => {
    set((state) => ({
      windows: {
        ...state.windows,
        [windowId]: { ...state.windows[windowId], width: size.width, height: size.height },
      },
    }));
  },
}));

export default useWindowStore;
