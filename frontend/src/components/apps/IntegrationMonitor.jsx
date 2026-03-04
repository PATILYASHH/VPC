import { useApiQuery } from '@/hooks/useApi';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { format } from 'date-fns';

const STATUS_VARIANT = {
  connected: 'success',
  disconnected: 'destructive',
  error: 'destructive',
  degraded: 'warning',
  unknown: 'secondary',
};

export default function IntegrationMonitor() {
  const { data, isLoading } = useApiQuery('integrations', '/admin/integrations', { refetchInterval: 10000 });

  if (isLoading) return <LoadingSpinner />;

  if (!data?.integrations?.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">No integrations configured</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Add entries to the integration_stats table to track external systems
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.integrations.map((int) => (
          <div key={int.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-medium text-sm">{int.system_name}</h3>
                {int.system_type && (
                  <span className="text-xs text-muted-foreground">{int.system_type}</span>
                )}
              </div>
              <Badge variant={STATUS_VARIANT[int.status] || 'secondary'} className="text-[10px]">
                {int.status}
              </Badge>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-muted-foreground/70">Requests Today</span>
                <span className="font-mono text-foreground">{int.total_requests_today}</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Errors Today</span>
                <span className={`font-mono ${int.total_errors_today > 0 ? 'text-destructive' : 'text-foreground'}`}>
                  {int.total_errors_today}
                </span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Avg Response</span>
                <span className="font-mono text-foreground">{int.avg_response_time_ms}ms</span>
              </div>
            </div>

            {int.last_ping_at && (
              <div className="mt-2 text-[10px] text-muted-foreground">
                Last ping: {format(new Date(int.last_ping_at), 'MMM d, HH:mm:ss')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
