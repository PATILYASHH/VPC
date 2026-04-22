import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, HardDrive, Activity } from 'lucide-react';
import { subscribe } from '@/lib/realtime';
import api from '@/lib/api';
import WidgetShell from './WidgetShell';

function Bar({ label, value, color = '#3b82f6', icon: Icon }) {
  const v = value == null || isNaN(value) ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-center gap-2 text-[10px] mb-1 opacity-80">
        {Icon && <Icon className="w-3 h-3" />}
        <span className="flex-1">{label}</span>
        <span className="font-mono">{value == null ? '—' : `${Math.round(value)}%`}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full transition-all duration-500" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

export default function SystemMetricsWidget({ onRemove }) {
  const [m, setM] = useState({ cpu: null, mem: null, disk: null });

  useEffect(() => {
    api.get('/admin/servers').then(({ data }) => {
      const sys = data.system || {};
      const disk = (data.disk || [])[0];
      setM({
        cpu: sys.cpu?.usage ?? sys.cpuUsage,
        mem: sys.memory?.usagePercent ?? sys.memoryUsagePercent,
        disk: disk?.usagePercent ?? disk?.use,
      });
    }).catch(() => {});

    return subscribe('metrics', (p) => {
      setM({
        cpu: p.sys?.cpu?.usage ?? p.sys?.cpuUsage,
        mem: p.sys?.memory?.usagePercent ?? p.sys?.memoryUsagePercent,
        disk: p.disk?.usagePercent ?? p.disk?.use,
      });
    });
  }, []);

  return (
    <WidgetShell title="System" icon={Activity} onRemove={onRemove}>
      <div className="p-3 space-y-2.5">
        <Bar label="CPU" value={m.cpu} color="#60a5fa" icon={Cpu} />
        <Bar label="Memory" value={m.mem} color="#34d399" icon={MemoryStick} />
        <Bar label="Disk" value={m.disk} color="#f59e0b" icon={HardDrive} />
      </div>
    </WidgetShell>
  );
}
