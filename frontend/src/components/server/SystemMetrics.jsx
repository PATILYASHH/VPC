import { Cpu, HardDrive, Clock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function SystemMetrics({ system }) {
  if (!system || !system.cpu_percent) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        System metrics unavailable
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Cpu className="w-4 h-4" />
          <span>CPU</span>
          <span className="ml-auto font-mono">{system.cpu_percent}%</span>
        </div>
        <Progress value={system.cpu_percent} className={system.cpu_percent > 80 ? '[&>div]:bg-destructive' : ''} />
        <p className="text-xs text-muted-foreground">{system.cpu_count} cores</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <HardDrive className="w-4 h-4" />
          <span>Memory</span>
          <span className="ml-auto font-mono">{system.memory_percent}%</span>
        </div>
        <Progress value={system.memory_percent} className={system.memory_percent > 80 ? '[&>div]:bg-warning' : ''} />
        <p className="text-xs text-muted-foreground">
          {system.memory_used_mb} / {system.memory_total_mb} MB
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>Uptime</span>
        </div>
        <p className="text-lg font-mono font-medium text-foreground">
          {formatUptime(system.uptime_seconds)}
        </p>
        <p className="text-xs text-muted-foreground">
          Load: {system.load_avg?.map((l) => l.toFixed(2)).join(', ')}
        </p>
      </div>
    </div>
  );
}
