import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Smartphone, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

const STATUS_COLORS = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  unregistered: 'bg-muted text-muted-foreground border-border',
  stale: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

export default function Devices({ project }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery(
    ['notify-devices', project.id],
    `/admin/notify/projects/${project.id}/devices`
  );

  const handleUnregister = async (device) => {
    if (!confirm(`Unregister device ${device.device_id.slice(0, 12)}...?`)) return;
    try {
      await api.delete(`/admin/notify/projects/${project.id}/devices/${device.device_id}`);
      queryClient.invalidateQueries({ queryKey: ['notify-devices', project.id] });
      toast.success('Device unregistered');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to unregister device');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  const devices = data?.devices || [];

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Devices ({data?.total ?? devices.length})</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Android installs registered against this project</p>
      </div>

      {devices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Smartphone className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No devices registered yet</p>
          <p className="text-xs mt-1">Call POST /devices/register with a client key from your Android app</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Device ID</th>
                <th className="text-left py-2 px-3 font-medium">Model</th>
                <th className="text-left py-2 px-3 font-medium">App Version</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-left py-2 px-3 font-medium">Last Seen</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="py-2 px-3 font-mono text-[11px]">{d.device_id.slice(0, 18)}...</td>
                  <td className="py-2 px-3 text-muted-foreground">{d.device_model || '—'}</td>
                  <td className="py-2 px-3 text-muted-foreground font-mono">{d.app_version || '—'}</td>
                  <td className="py-2 px-3">
                    <Badge className={`text-[9px] ${STATUS_COLORS[d.status] || ''}`}>{d.status}</Badge>
                  </td>
                  <td className="py-2 px-3 text-muted-foreground">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 px-2">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleUnregister(d)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
