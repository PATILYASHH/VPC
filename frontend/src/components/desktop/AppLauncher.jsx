import { useEffect, useRef } from 'react';
import useDesktopStore from '@/stores/useDesktopStore';
import APP_REGISTRY from '@/lib/appRegistry';
import AppIcon from './AppIcon';

export default function AppLauncher() {
  const closeLauncher = useDesktopStore((s) => s.closeLauncher);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        closeLauncher();
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') closeLauncher();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [closeLauncher]);

  const appIds = Object.keys(APP_REGISTRY);

  return (
    <div
      ref={ref}
      className="absolute bottom-14 left-2 w-80 bg-card/95 backdrop-blur-md border rounded-lg shadow-xl p-4 z-[10000]"
    >
      <p className="text-xs text-muted-foreground mb-3 px-1">Applications</p>
      <div className="grid grid-cols-3 gap-1">
        {appIds.map((appId) => (
          <AppIcon key={appId} appId={appId} />
        ))}
      </div>
    </div>
  );
}
