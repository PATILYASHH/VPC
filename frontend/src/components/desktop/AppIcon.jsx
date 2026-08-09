import { useRef } from 'react';
import { X } from 'lucide-react';
import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import APP_REGISTRY from '@/lib/appRegistry';

// Vibrant gradient backgrounds for each app color
const ICON_GRADIENTS = {
  'text-violet-400': 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  'text-emerald-400': 'linear-gradient(135deg, #34d399, #059669)',
  'text-blue-400': 'linear-gradient(135deg, #60a5fa, #2563eb)',
  'text-cyan-400': 'linear-gradient(135deg, #22d3ee, #0891b2)',
  'text-orange-400': 'linear-gradient(135deg, #fb923c, #ea580c)',
  'text-green-400': 'linear-gradient(135deg, #4ade80, #16a34a)',
  'text-yellow-400': 'linear-gradient(135deg, #facc15, #ca8a04)',
  'text-indigo-400': 'linear-gradient(135deg, #818cf8, #4f46e5)',
  'text-amber-400': 'linear-gradient(135deg, #fbbf24, #d97706)',
  'text-slate-400': 'linear-gradient(135deg, #94a3b8, #475569)',
  'text-pink-400': 'linear-gradient(135deg, #f472b6, #db2777)',
  'text-teal-400': 'linear-gradient(135deg, #2dd4bf, #0d9488)',
  'text-purple-400': 'linear-gradient(135deg, #c084fc, #9333ea)',
  'text-red-400': 'linear-gradient(135deg, #f87171, #dc2626)',
  'text-zinc-400': 'linear-gradient(135deg, #a1a1aa, #52525b)',
  'text-primary': 'linear-gradient(135deg, #60a5fa, #2563eb)',
};

// DRAG_THRESHOLD: pixels of movement before a mousedown counts as a drag
// rather than a click — keeps normal clicks from being swallowed by jitter.
const DRAG_THRESHOLD = 4;
// HOLD_MS: how long the mouse must stay down before we treat it as "hold to
// customize" (reveals the remove button) rather than a plain click.
const HOLD_MS = 450;

export default function AppIcon({
  appId,
  draggable = false,
  style,
  isDragging = false,
  onMove,
  onDrop,
  onRemove,
  showRemove = false,
  onHoldStart,
  onHoldEnd,
}) {
  const openWindow = useWindowStore((s) => s.openWindow);
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const appDef = APP_REGISTRY[appId];
  const draggedRef = useRef(false);
  const holdTimerRef = useRef(null);
  const heldRef = useRef(false);

  if (!appDef) return null;
  const Icon = appDef.icon;
  const gradient = ICON_GRADIENTS[appDef.iconColor] || 'linear-gradient(135deg, #60a5fa, #2563eb)';

  const handleClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (heldRef.current) {
      // This is the release right after the long-press fired — it already
      // entered hold/customize mode (see onHoldStart below). Consume it
      // without also opening the app or immediately backing out again.
      heldRef.current = false;
      return;
    }
    if (showRemove) {
      // A separate, later click while already in hold mode — back out of it.
      onHoldEnd?.();
      return;
    }
    openWindow(appId);
    closeLauncher();
  };

  const handleMouseDown = (e) => {
    if (!draggable) return;
    e.preventDefault();
    draggedRef.current = false;
    heldRef.current = false;
    const startX = e.clientX;
    const startY = e.clientY;

    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      heldRef.current = true;
      onHoldStart?.();
    }, HOLD_MS);

    const handleMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        draggedRef.current = true;
        clearTimeout(holdTimerRef.current);
      }
      onMove?.(dx, dy);
    };
    const handleMouseUp = (ev) => {
      clearTimeout(holdTimerRef.current);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      onDrop?.(ev.clientX - startX, ev.clientY - startY, draggedRef.current);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      className="relative"
      data-app-icon-id={appId}
      style={draggable ? { position: 'absolute', ...style, zIndex: isDragging ? 30 : 1, transition: isDragging ? 'none' : 'left 120ms ease, top 120ms ease' } : undefined}
    >
      <button
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        className={`flex flex-col items-center gap-1.5 w-full sm:w-20 p-2 rounded-xl transition-all duration-150 group active:scale-95 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-[14px] flex items-center justify-center group-hover:scale-105 transition-transform duration-150"
          style={{
            background: gradient,
            boxShadow: `0 4px 14px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.1)`,
          }}
        >
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white drop-shadow-sm" />
        </div>
        <span
          className="text-[10px] sm:text-[11px] text-center leading-tight truncate w-full font-medium"
          style={{ color: 'var(--text-on-surface)' }}
        >
          {appDef.title}
        </span>
      </button>

      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Remove from Desktop"
          className={`absolute top-0 right-1 w-[18px] h-[18px] rounded-full flex items-center justify-center bg-black/60 text-white transition-opacity hover:bg-red-500 ${showRemove ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}
