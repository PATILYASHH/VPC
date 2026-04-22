import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Wifi, WifiOff, Activity, Bell, Clock } from 'lucide-react';
import api from '@/lib/api';
import { subscribe } from '@/lib/realtime';
import useWindowStore from '@/stores/useWindowStore';
import useNotificationStore from '@/stores/useNotificationStore';

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return `${Math.round(n)}%`;
}

function fmtUptime(seconds) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function colorFor(pct) {
  if (pct == null) return 'text-foreground/40';
  if (pct >= 90) return 'text-rose-400';
  if (pct >= 75) return 'text-amber-400';
  return 'text-emerald-400';
}

export default function StatusBar() {
  const [metrics, setMetrics] = useState({ cpu: null, mem: null, disk: null, uptime: null, online: true });
  const openWindow = useWindowStore((s) => s.openWindow);
  const togglePanel = useNotificationStore((s) => s.togglePanel);
  const items = useNotificationStore((s) => s.items);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    let alive = true;

    const apply = (sys, disk) => {
      if (!alive) return;
      setMetrics({
        cpu: sys?.cpu?.usage ?? sys?.cpuUsage ?? null,
        mem: sys?.memory?.usagePercent ?? sys?.memoryUsagePercent ?? null,
        disk: disk?.usagePercent ?? disk?.use ?? null,
        uptime: sys?.uptime ?? null,
        online: true,
      });
    };

    // Initial poll for fast first paint
    api.get('/admin/servers')
      .then(({ data }) => apply(data.system || {}, (data.disk || [])[0]))
      .catch(() => alive && setMetrics((m) => ({ ...m, online: false })));

    // Subscribe to live SSE metrics
    const unsub = subscribe('metrics', (p) => apply(p.sys, p.disk));
    return () => { alive = false; unsub(); };
  }, []);

  return (
    <div
      className="fixed bottom-11 left-0 right-0 h-6 z-[9996] backdrop-blur-xl border-t flex items-center px-2 gap-1 text-[10px] font-mono select-none"
      style={{ background: 'var(--taskbar-bg)', borderColor: 'var(--surface-border)' }}
    >
      {/* Online */}
      <div className="flex items-center gap-1 px-1.5 opacity-70">
        {metrics.online ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-rose-400" />}
        <span>{metrics.online ? 'online' : 'offline'}</span>
      </div>

      <div className="w-px h-3" style={{ background: 'var(--surface-border)' }} />

      {/* CPU */}
      <button
        onClick={() => openWindow('server-manager')}
        className="flex items-center gap-1 px-1.5 hover:bg-white/[0.05] h-5 rounded"
        title="CPU usage — click to open Server Manager"
      >
        <Cpu className={`w-3 h-3 ${colorFor(metrics.cpu)}`} />
        <span className={colorFor(metrics.cpu)}>{fmtPct(metrics.cpu)}</span>
      </button>

      {/* Memory */}
      <button
        onClick={() => openWindow('server-manager')}
        className="flex items-center gap-1 px-1.5 hover:bg-white/[0.05] h-5 rounded"
        title="Memory usage"
      >
        <MemoryStick className={`w-3 h-3 ${colorFor(metrics.mem)}`} />
        <span className={colorFor(metrics.mem)}>{fmtPct(metrics.mem)}</span>
      </button>

      {/* Disk */}
      <button
        onClick={() => openWindow('server-manager')}
        className="flex items-center gap-1 px-1.5 hover:bg-white/[0.05] h-5 rounded"
        title="Disk usage"
      >
        <HardDrive className={`w-3 h-3 ${colorFor(metrics.disk)}`} />
        <span className={colorFor(metrics.disk)}>{fmtPct(metrics.disk)}</span>
      </button>

      <div className="w-px h-3" style={{ background: 'var(--surface-border)' }} />

      {/* Uptime */}
      <div className="flex items-center gap-1 px-1.5 opacity-60">
        <Clock className="w-3 h-3" />
        <span>up {fmtUptime(metrics.uptime)}</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Notification bell */}
      <button
        onClick={togglePanel}
        className="relative flex items-center gap-1 px-2 hover:bg-white/[0.05] h-5 rounded"
        title="Notifications"
      >
        <Bell className="w-3 h-3 opacity-70" />
        {unread > 0 ? (
          <>
            <span className="opacity-90">{unread}</span>
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400" />
          </>
        ) : (
          <span className="opacity-40">0</span>
        )}
      </button>
    </div>
  );
}
