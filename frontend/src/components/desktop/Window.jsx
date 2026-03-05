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

  if (!win || win.isMinimized) return null;

  const appDef = APP_REGISTRY[win.appId];
  if (!appDef) return null;

  const AppComponent = appDef.component;
  const isActive = activeWindowId === windowId;

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
        className={`flex flex-col h-full bg-card border rounded-lg overflow-hidden shadow-2xl transition-shadow ${
          isActive
            ? 'border-border shadow-2xl'
            : 'border-border/50 shadow-lg opacity-95'
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
