import { useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import ServiceCard from '@/components/server/ServiceCard';
import SystemMetrics from '@/components/server/SystemMetrics';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

export default function ServerManager() {
  const [restartingService, setRestartingService] = useState(null);

  const { data, isLoading, error, refetch } = useApiQuery(
    'servers',
    '/admin/servers',
    { refetchInterval: 5000 }
  );

  const handleRestart = async (serviceName) => {
    if (!confirm(`Restart service "${serviceName}"?`)) return;

    setRestartingService(serviceName);
    try {
      await api.post('/admin/servers/restart', { service: serviceName });
      toast.success(`Service "${serviceName}" restarted`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Restart failed');
    } finally {
      setRestartingService(null);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-destructive mb-2">Failed to load server status</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">System</h2>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <SystemMetrics system={data?.system} />
        {data?.pm2_error && (
          <p className="text-xs text-warning mt-3">PM2: {data.pm2_error}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Processes ({data?.processes?.length || 0})
        </h2>

        {data?.processes?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PM2 processes found</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data?.processes?.map((proc) => (
              <ServiceCard
                key={proc.pm_id}
                process={proc}
                onRestart={handleRestart}
                isRestarting={restartingService === proc.name}
              />
            ))}
          </div>
        )}

        {data?.disk?.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Disk Usage
            </h2>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted text-muted-foreground">
                    <th className="text-left p-2">Mount</th>
                    <th className="text-left p-2">Size</th>
                    <th className="text-left p-2">Used</th>
                    <th className="text-left p-2">Available</th>
                    <th className="text-left p-2">Use%</th>
                  </tr>
                </thead>
                <tbody>
                  {data.disk.map((d, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono">{d.mount}</td>
                      <td className="p-2 font-mono">{d.size}</td>
                      <td className="p-2 font-mono">{d.used}</td>
                      <td className="p-2 font-mono">{d.available}</td>
                      <td className="p-2 font-mono">{d.use_percent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
