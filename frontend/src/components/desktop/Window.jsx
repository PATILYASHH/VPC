import { useState, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import useWindowStore from '@/stores/useWindowStore';
import APP_REGISTRY from '@/lib/appRegistry';
import WindowTitleBar from './WindowTitleBar';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

export default function Window({ windowId }) {
  const win = useWindowStore((s) => s.windows[windowId]);
  const activeWindowId = useWindowStore((s) => s.activeWindowId);
  const focusWindow = useWindowStore((s) => s.focusWindow);
  const updatePosition = useWindowStore((s) => s.updatePosition);
  const updateSize = useWindowStore((s) => s.updateSize);

  const [shouldRender, setShouldRender] = useState(!win?.isMinimized);
  const [animatingOut, setAnimatingOut] = useState(false);
  const [animatingIn, setAnimatingIn] = useState(false);
  const prevMinimized = useRef(win?.isMinimized ?? false);

  useEffect(() => {
    if (!win) return;

    if (win.isMinimized && !prevMinimized.current) {
      // Minimize: animate out, then remove from DOM
      prevMinimized.current = true;
      setAnimatingOut(true);
      const t = setTimeout(() => {
        setAnimatingOut(false);
        setShouldRender(false);
      }, 220);
      return () => clearTimeout(t);
    }

    if (!win.isMinimized && prevMinimized.current) {
      // Restore: mount collapsed, then transition to full size
      prevMinimized.current = false;
      setAnimatingIn(true);
      setShouldRender(true);
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setAnimatingIn(false))
      );
      return () => cancelAnimationFrame(raf);
    }
  }, [win?.isMinimized]);

  if (!win || !shouldRender) return null;

  const appDef = APP_REGISTRY[win.appId];
  if (!appDef) return null;

  const AppComponent = appDef.component;
  const isActive = activeWindowId === windowId;
  const isAnimating = animatingOut || animatingIn;

  return (
    <Rnd
      position={{ x: win.x, y: win.y }}
      size={{ width: win.width, height: win.height }}
      minWidth={win.minWidth}
      minHeight={win.minHeight}
      style={{ zIndex: win.zIndex, pointerEvents: 'auto' }}
      dragHandleClassName="window-drag-handle"
      bounds="parent"
      disableDragging={win.isMaximized}
      enableResizing={!win.isMaximized}
      onDragStop={(e, d) => updatePosition(windowId, { x: d.x, y: d.y })}
      onResizeStop={(e, direction, ref, delta, position) => {
        updateSize(windowId, {
          width: parseInt(ref.style.width),
          height: parseInt(ref.style.height),
        });
        updatePosition(windowId, position);
      }}
      onMouseDown={() => focusWindow(windowId)}
    >
      <div
        style={{ transition: 'transform 220ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease' }}
        className={`flex flex-col h-full bg-card border rounded-lg overflow-hidden shadow-2xl origin-bottom ${
          isAnimating
            ? 'scale-90 opacity-0 translate-y-6'
            : isActive
            ? 'scale-100 opacity-100 translate-y-0 border-border shadow-2xl'
            : 'scale-100 opacity-100 translate-y-0 border-border/50 shadow-lg opacity-95'
        }`}
      >
        <WindowTitleBar windowId={windowId} isActive={isActive} />
        <div className="flex-1 overflow-auto bg-background">
          <ErrorBoundary>
            <AppComponent />
          </ErrorBoundary>
        </div>
      </div>
    </Rnd>
  );
}
