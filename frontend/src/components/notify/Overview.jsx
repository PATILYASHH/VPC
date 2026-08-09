import { Smartphone, Send, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

const TILES = [
  { key: 'active_devices', label: 'Active Devices', icon: Smartphone, color: 'text-blue-400' },
  { key: 'total_messages', label: 'Messages Sent', icon: Send, color: 'text-violet-400' },
  { key: 'total_delivered', label: 'Delivered', icon: CheckCircle2, color: 'text-emerald-400' },
  { key: 'total_pending', label: 'Pending / Queued', icon: Clock, color: 'text-amber-400' },
  { key: 'total_failed', label: 'Failed', icon: XCircle, color: 'text-destructive' },
];

export default function Overview({ project }) {
  const { data, isLoading } = useApiQuery(
    ['notify-project', project.id],
    `/admin/notify/projects/${project.id}`
  );

  if (isLoading) return <LoadingSpinner />;

  const stats = data?.stats || {};

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Overview</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Delivery stats for "{project.name}"</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {TILES.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="border rounded-lg p-3 bg-card">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
            <span className="text-lg font-semibold font-mono">{stats[key] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="border rounded-lg p-4 bg-muted/30 text-xs text-muted-foreground space-y-1.5">
        <p>
          NOTIFY delivers over a self-hosted WebSocket connection — no Firebase/Google dependency. This dashboard
          (M1) covers projects, API keys, device registration, and message send/status tracking against the
          database. Live delivery over the WebSocket gateway and offline retry/queueing land in later milestones —
          until then, sent messages stay <span className="font-mono">queued</span>.
        </p>
      </div>
    </div>
  );
}
