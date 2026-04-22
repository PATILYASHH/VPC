import { Rocket } from 'lucide-react';
import useWindowStore from '@/stores/useWindowStore';
import useAuthStore from '@/stores/useAuthStore';
import APP_REGISTRY from '@/lib/appRegistry';
import WidgetShell from './WidgetShell';

export default function QuickAppsWidget({ onRemove }) {
  const openWindow = useWindowStore((s) => s.openWindow);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const apps = Object.values(APP_REGISTRY)
    .filter((a) => !a.permission || hasPermission(a.permission))
    .slice(0, 12);

  return (
    <WidgetShell title="Quick Launch" icon={Rocket} onRemove={onRemove}>
      <div className="p-2 grid grid-cols-4 gap-1.5">
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              onClick={() => openWindow(app.id)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-1 hover:scale-[1.05] transition-transform ${app.iconBg || 'bg-white/[0.04]'}`}
              title={app.title}
            >
              <Icon className={`w-4 h-4 ${app.iconColor}`} />
              <span className="text-[9px] opacity-60 truncate w-full text-center px-1">{app.title}</span>
            </button>
          );
        })}
      </div>
    </WidgetShell>
  );
}
