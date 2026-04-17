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

export default function AppIcon({ appId }) {
  const openWindow = useWindowStore((s) => s.openWindow);
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const appDef = APP_REGISTRY[appId];

  if (!appDef) return null;
  const Icon = appDef.icon;
  const gradient = ICON_GRADIENTS[appDef.iconColor] || 'linear-gradient(135deg, #60a5fa, #2563eb)';

  const handleClick = () => {
    openWindow(appId);
    closeLauncher();
  };

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleClick}
      className="flex flex-col items-center gap-1.5 w-full sm:w-20 p-2 rounded-xl transition-all duration-150 group active:scale-95"
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
  );
}
