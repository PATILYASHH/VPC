import useWindowStore from '@/stores/useWindowStore';
import useDesktopStore from '@/stores/useDesktopStore';
import APP_REGISTRY from '@/lib/appRegistry';

export default function AppIcon({ appId }) {
  const openWindow = useWindowStore((s) => s.openWindow);
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const appDef = APP_REGISTRY[appId];

  if (!appDef) return null;
  const Icon = appDef.icon;

  const handleClick = () => {
    openWindow(appId);
    closeLauncher();
  };

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleClick}
      className="flex flex-col items-center gap-1.5 w-20 p-2 rounded-xl hover:bg-white/[0.08] transition-all duration-150 group"
    >
      <div className={`w-12 h-12 rounded-xl ${appDef.iconBg || 'bg-primary/10'} flex items-center justify-center group-hover:scale-105 transition-transform duration-150 shadow-lg shadow-black/20`}>
        <Icon className={`w-6 h-6 ${appDef.iconColor || 'text-primary'}`} />
      </div>
      <span className="text-[11px] text-white/80 text-center leading-tight truncate w-full font-medium drop-shadow-sm">
        {appDef.title}
      </span>
    </button>
  );
}
