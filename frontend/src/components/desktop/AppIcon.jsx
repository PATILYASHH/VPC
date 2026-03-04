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
      className="flex flex-col items-center gap-1.5 w-20 p-2 rounded-lg hover:bg-white/10 transition-colors group"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <span className="text-xs text-foreground/80 text-center leading-tight truncate w-full">
        {appDef.title}
      </span>
    </button>
  );
}
