import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Download, RotateCcw } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';

const STATUS_VARIANT = {
  running: 'warning',
  completed: 'success',
  failed: 'destructive',
  restored: 'secondary',
};

function formatBytes(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function BackupManager() {
  const [running, setRunning] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery('backups', '/admin/backup/list', { refetchInterval: 5000 });

  const handleRunBackup = async () => {
    setRunning(true);
    try {
      await api.post('/admin/backup/run', { backup_type: 'full' });
      toast.success('Backup started');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Backup failed');
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = async (id) => {
    try {
      const response = await api.get(`/admin/backup/download/${id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'backup.sql.gz';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  };

  const handleRestore = async (id) => {
    if (!confirm('Are you sure you want to restore this backup? This will overwrite current data.')) return;
    try {
      await api.post(`/admin/backup/restore/${id}`, { confirm: true });
      toast.success('Backup restored');
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Restore failed');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Database Backups</h2>
        <Button size="sm" onClick={handleRunBackup} disabled={running}>
          <Play className="w-3.5 h-3.5 mr-1.5" />
          {running ? 'Running...' : 'Run Backup'}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              <th className="text-left p-3 font-medium text-muted-foreground">Filename</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Size</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.backups?.map((b) => (
              <tr key={b.id} className="border-b hover:bg-accent/30">
                <td className="p-3 font-mono truncate max-w-[200px]">{b.filename}</td>
                <td className="p-3">{b.backup_type}</td>
                <td className="p-3 font-mono">{formatBytes(b.file_size_bytes)}</td>
                <td className="p-3">
                  <Badge variant={STATUS_VARIANT[b.status] || 'secondary'} className="text-[10px]">
                    {b.status}
                  </Badge>
                </td>
                <td className="p-3">{format(new Date(b.created_at), 'MMM d, yyyy HH:mm')}</td>
                <td className="p-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {b.status === 'completed' && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(b.id)} title="Download">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRestore(b.id)} title="Restore">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!data?.backups || data.backups.length === 0) && (
          <div className="p-8 text-center text-sm text-muted-foreground">No backups yet</div>
        )}
      </div>
    </div>
  );
}
