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
    // Apps without a permission key are always visible
    if (!app.permission) return true;
    return hasPermission(app.permission);
  });

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(220,40%,13%)]">
      {/* Desktop icon grid */}
      <div className="absolute inset-0 bottom-12 p-6">
        <div className="flex flex-col flex-wrap gap-4 h-full content-start">
          {appIds.map((appId) => (
            <AppIcon key={appId} appId={appId} />
          ))}
        </div>
      </div>

      {/* Window layer (pointer-events-none so icons stay clickable) */}
      <div className="absolute inset-0 bottom-12 pointer-events-none">
        <WindowManager />
      </div>

      {/* Taskbar */}
      <Taskbar />

      {/* App launcher */}
      {launcherOpen && <AppLauncher />}
    </div>
  );
}
