import useDesktopStore from '@/stores/useDesktopStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY from '@/lib/appRegistry';
import WindowManager from './WindowManager';
import Taskbar from './Taskbar';
import AppLauncher from './AppLauncher';
import AppIcon from './AppIcon';

export default function Desktop() {
  const launcherOpen = useDesktopStore((s) => s.launcherOpen);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const allAppIds = Object.keys(APP_REGISTRY);
  const appIds = allAppIds.filter((id) => {
    const app = APP_REGISTRY[id];
    if (!app.permission) return true;
    return hasPermission(app.permission);
  });

  return (
    <div className="h-screen w-screen overflow-hidden relative" style={{ background: 'var(--desktop-bg)' }}>
      {/* Gradient background */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom right, var(--desktop-gradient-from), var(--desktop-gradient-via), var(--desktop-gradient-to))` }} />
      {/* Subtle dot pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(circle, var(--dot-pattern) 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
      }} />
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-[120px]" style={{ background: 'var(--glow-color)' }} />

      {/* Desktop icon grid */}
      <div className="absolute inset-0 bottom-12 p-6 z-10">
        <div className="flex flex-col flex-wrap gap-2 h-full content-start">
          {appIds.map((appId) => (
            <AppIcon key={appId} appId={appId} />
          ))}
        </div>
      </div>

      {/* Window layer */}
      <div className="absolute inset-0 bottom-12 pointer-events-none z-20">
        <WindowManager />
      </div>

      {/* Taskbar */}
      <Taskbar />

      {/* App launcher */}
      {launcherOpen && <AppLauncher />}
    </div>
  );
}
