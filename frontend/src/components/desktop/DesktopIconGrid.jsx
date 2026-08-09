import { useState, useRef, useEffect } from 'react';
import useDesktopStore from '@/stores/useDesktopStore';
import AppIcon from './AppIcon';

const CELL_W = 92;
const CELL_H = 96;

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

export default function DesktopIconGrid({ appIds }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [dragState, setDragState] = useState(null); // { appId, dx, dy }
  const [heldAppId, setHeldAppId] = useState(null); // icon currently in "hold to customize" mode

  const iconPositions = useDesktopStore((s) => s.iconPositions);
  const getPinnedAppIds = useDesktopStore((s) => s.getPinnedAppIds);
  const unpinApp = useDesktopStore((s) => s.unpinApp);
  const moveIcon = useDesktopStore((s) => s.moveIcon);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clicking anywhere outside the held icon exits "customize" mode.
  useEffect(() => {
    if (!heldAppId) return;
    const handleOutside = (e) => {
      if (e.target.closest(`[data-app-icon-id="${heldAppId}"]`)) return;
      setHeldAppId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [heldAppId]);

  const rowsPerColumn = Math.max(1, Math.floor(size.height / CELL_H));
  const maxCols = Math.max(3, Math.floor(size.width / CELL_W));

  const pinned = getPinnedAppIds(appIds);

  // Effective position for every pinned icon: an explicit saved position, or
  // the next free column-major slot for icons that haven't been moved yet
  // (mirrors the old auto-flow layout until the user customizes something).
  const occupied = new Set();
  for (const id of pinned) {
    const pos = iconPositions[id];
    if (pos) occupied.add(`${pos.col},${pos.row}`);
  }
  let scanCol = 0;
  let scanRow = 0;
  const nextFreeSlot = () => {
    while (occupied.has(`${scanCol},${scanRow}`)) {
      scanRow++;
      if (scanRow >= rowsPerColumn) {
        scanRow = 0;
        scanCol++;
      }
    }
    occupied.add(`${scanCol},${scanRow}`);
    return { col: scanCol, row: scanRow };
  };
  const effective = {};
  for (const id of pinned) {
    effective[id] = iconPositions[id] || nextFreeSlot();
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {pinned.map((appId) => {
        const pos = effective[appId];
        const isDragging = dragState?.appId === appId;
        const dx = isDragging ? dragState.dx : 0;
        const dy = isDragging ? dragState.dy : 0;

        return (
          <AppIcon
            key={appId}
            appId={appId}
            draggable
            isDragging={isDragging}
            style={{ left: pos.col * CELL_W + dx, top: pos.row * CELL_H + dy, width: CELL_W }}
            onMove={(mdx, mdy) => setDragState({ appId, dx: mdx, dy: mdy })}
            onDrop={(ddx, ddy, wasDragged) => {
              setDragState(null);
              if (!wasDragged) return;
              const col = clamp(Math.round((pos.col * CELL_W + ddx) / CELL_W), 0, maxCols - 1);
              const row = clamp(Math.round((pos.row * CELL_H + ddy) / CELL_H), 0, rowsPerColumn - 1);
              moveIcon(appId, { col, row });
            }}
            onRemove={() => { setHeldAppId(null); unpinApp(appId, appIds); }}
            showRemove={heldAppId === appId}
            onHoldStart={() => setHeldAppId(appId)}
            onHoldEnd={() => setHeldAppId(null)}
          />
        );
      })}
    </div>
  );
}
