import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

export default function BanaSettings({ project }) {
  const [storageLimitMb, setStorageLimitMb] = useState(project.storage_limit_mb);
  const [maxConnections, setMaxConnections] = useState(project.max_connections);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const { data: details, isLoading } = useApiQuery(
    ['bana-project-detail', project.id],
    baseUrl
  );

  useEffect(() => {
    if (details?.project) {
      setStorageLimitMb(details.project.storage_limit_mb);
      setMaxConnections(details.project.max_connections);
    }
  }, [details]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`${baseUrl}/settings`, { storageLimitMb, maxConnections });
      queryClient.invalidateQueries({ queryKey: ['bana-project-detail'] });
      queryClient.invalidateQueries({ queryKey: ['bana-projects'] });
      toast.success('Settings updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`DELETE project "${project.name}"?\n\nThis will permanently drop the database and all data. This cannot be undone.`)) return;
    if (!confirm('Are you absolutely sure? Type the project name to confirm:')) return;

    try {
      await api.delete(`/admin/bana/projects/${project.id}`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['bana-projects'] });
      toast.success('Project deleted');
      // Parent will handle navigation back
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete project');
    }
  };

  const copyText = copyToClipboard;

  if (isLoading) return <LoadingSpinner />;

  const proj = details?.project || project;
  const stats = details?.stats || {};
  const storagePercent = (stats.storage_used_mb / proj.storage_limit_mb) * 100;

  return (
    <div className="h-full overflow-auto p-4 space-y-6 max-w-2xl">
      {/* Connection Info */}
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3">Connection Info</h3>
        <div className="space-y-2">
          {[
            { label: 'Host', value: process.env.DB_HOST || window.location.hostname },
            { label: 'Port', value: '5432' },
            { label: 'Database', value: proj.db_name },
            { label: 'User', value: proj.db_user },
            { label: 'Password', value: showPassword ? proj.db_password : '••••••••••••' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2">
              <Label className="text-xs w-20 shrink-0 text-muted-foreground">{label}</Label>
              <Input value={value} readOnly className="font-mono text-xs h-8 flex-1" />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => copyText(label === 'Password' ? proj.db_password : value)}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          ))}
          <Button variant="link" size="sm" className="text-xs h-6 px-0" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? 'Hide password' : 'Show password'}
          </Button>
        </div>

        <div className="mt-3 p-2 bg-muted rounded text-xs font-mono">
          <p className="text-muted-foreground"># psql connection string:</p>
          <p>psql postgresql://{proj.db_user}:{showPassword ? proj.db_password : '****'}@{window.location.hostname}:5432/{proj.db_name}</p>
        </div>
      </div>

      {/* Resource Usage */}
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3">Resource Usage</h3>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Storage Used</span>
              <span className={`font-mono ${storagePercent >= 100 ? 'text-destructive font-medium' : storagePercent > 80 ? 'text-amber-500' : ''}`}>
                {stats.storage_used_mb || 0} MB / {proj.storage_limit_mb} MB allocated
              </span>
            </div>
            <Progress
              value={Math.min(storagePercent, 100)}
              className={`h-2 ${storagePercent >= 100 ? '[&>div]:bg-destructive' : storagePercent > 80 ? '[&>div]:bg-amber-500' : ''}`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {Math.max(0, proj.storage_limit_mb - (stats.storage_used_mb || 0))} MB remaining.
              Writes are blocked when storage is full.
            </p>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Active Connections</span>
            <span>{stats.active_connections || 0} / {proj.max_connections}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Auth Users</span>
            <span>{stats.auth_user_count || 0}</span>
          </div>
        </div>
      </div>

      {/* Resource Limits */}
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3">Resource Limits</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Storage Limit (MB)</Label>
            <Input
              type="number"
              value={storageLimitMb}
              onChange={(e) => setStorageLimitMb(parseInt(e.target.value) || 500)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max Connections</Label>
            <Input
              type="number"
              value={maxConnections}
              onChange={(e) => setMaxConnections(parseInt(e.target.value) || 10)}
              className="text-sm"
            />
          </div>
        </div>
        <Button size="sm" className="mt-3" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Danger Zone */}
      <div className="border border-destructive/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Deleting this project will permanently drop the PostgreSQL database and all associated data. This action cannot be undone.
        </p>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          Delete Project
        </Button>
      </div>
    </div>
  );
}
