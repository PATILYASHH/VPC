import { RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function formatMemory(bytes) {
  if (!bytes) return '0 MB';
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function formatUptime(ms) {
  if (!ms) return '-';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const STATUS_VARIANT = {
  online: 'success',
  stopping: 'warning',
  stopped: 'destructive',
  errored: 'destructive',
  launching: 'warning',
};

export default function ServiceCard({ process, onRestart, isRestarting }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">{process.name}</h3>
          <Badge variant={STATUS_VARIANT[process.status] || 'secondary'} className="text-[10px]">
            {process.status}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRestart(process.name)}
          disabled={isRestarting}
          title="Restart"
        >
          <RotateCcw className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="block text-muted-foreground/70">PID</span>
          <span className="font-mono">{process.pid || '-'}</span>
        </div>
        <div>
          <span className="block text-muted-foreground/70">CPU</span>
          <span className="font-mono">{process.cpu}%</span>
        </div>
        <div>
          <span className="block text-muted-foreground/70">Memory</span>
          <span className="font-mono">{process.memory_mb || formatMemory(process.memory)}</span>
        </div>
        <div>
          <span className="block text-muted-foreground/70">Uptime</span>
          <span className="font-mono">{formatUptime(process.uptime)}</span>
        </div>
        <div>
          <span className="block text-muted-foreground/70">Restarts</span>
          <span className="font-mono">{process.restarts}</span>
        </div>
        <div>
          <span className="block text-muted-foreground/70">PM2 ID</span>
          <span className="font-mono">{process.pm_id}</span>
        </div>
      </div>
    </div>
  );
}
