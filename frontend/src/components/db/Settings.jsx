import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, AlertTriangle, Eraser, HardDrive, Download, RotateCcw, Trash2, Clock, Loader2, CheckCircle2, XCircle, Play } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

export default function Settings({ project }) {
  const [storageLimitMb, setStorageLimitMb] = useState(project.storage_limit_mb);
  const [maxConnections, setMaxConnections] = useState(project.max_connections);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/db/projects/${project.id}`;
  const { data: details, isLoading } = useApiQuery(
    ['db-project-detail', project.id],
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
      queryClient.invalidateQueries({ queryKey: ['db-project-detail'] });
      queryClient.invalidateQueries({ queryKey: ['db-projects'] });
      toast.success('Settings updated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllRows = async () => {
    if (!confirm(`Delete ALL rows from ALL tables in "${project.name}"?\n\nThis will clear all data but keep the table structure intact.`)) return;
    if (!confirm('Are you sure? All data in every table will be permanently deleted.')) return;

    setClearing(true);
    try {
      const { data: result } = await api.delete(`/admin/db/projects/${project.id}/rows`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['db-project-detail'] });
      queryClient.invalidateQueries({ queryKey: ['db-projects'] });
      const totalRows = result.details?.reduce((sum, t) => sum + t.rows_deleted, 0) || 0;
      toast.success(`Cleared ${totalRows} rows from ${result.tables_cleared} tables`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`DELETE project "${project.name}"?\n\nThis will permanently drop the database and all data. This cannot be undone.`)) return;
    if (!confirm('Are you absolutely sure? Type the project name to confirm:')) return;

    try {
      await api.delete(`/admin/db/projects/${project.id}`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['db-projects'] });
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

      {/* Backups */}
      <BackupSection projectId={project.id} />

      {/* Danger Zone */}
      <div className="border border-destructive/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
        </div>

        <div className="space-y-4">
          {/* Delete All Rows */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium">Delete All Rows</p>
              <p className="text-xs text-muted-foreground">
                Clear all data from every table. Tables and schema remain intact — only rows are removed.
                Deletes in correct order based on foreign key relationships.
              </p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground" onClick={handleDeleteAllRows} disabled={clearing}>
              <Eraser className="w-3 h-3 mr-1.5" />
              {clearing ? 'Clearing...' : 'Delete Rows'}
            </Button>
          </div>

          <div className="border-t border-destructive/10" />

          {/* Delete Project */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium">Delete Project</p>
              <p className="text-xs text-muted-foreground">
                Permanently drop the PostgreSQL database and all associated data. This action cannot be undone.
              </p>
            </div>
            <Button variant="destructive" size="sm" className="shrink-0" onClick={handleDelete}>
              Delete Project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Backup Section ─────────────────────────────────────────

function BackupSection({ projectId }) {
  const [schedule, setSchedule] = useState({ enabled: false, interval: 'daily', keepCount: 7 });
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const queryClient = useQueryClient();
  const base = `/admin/db/projects/${projectId}`;

  const { data: backupData, isLoading: backupsLoading } = useApiQuery(
    ['project-backups', projectId],
    `${base}/backups`,
    { refetchInterval: 10000 }
  );

  useEffect(() => {
    api.get(`${base}/backup-schedule`).then(({ data }) => {
      setSchedule(data);
    }).catch(() => {}).finally(() => setLoadingSchedule(false));
  }, [projectId]);

  async function saveSchedule(updates) {
    const newSchedule = { ...schedule, ...updates };
    setSchedule(newSchedule);
    setSavingSchedule(true);
    try {
      await api.post(`${base}/backup-schedule`, newSchedule);
      toast.success(newSchedule.enabled ? `Auto-backup: ${newSchedule.interval}` : 'Auto-backup disabled');
    } catch {
      toast.error('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  }

  async function createBackup() {
    setCreatingBackup(true);
    try {
      await api.post(`${base}/backups`, { backupType: 'full' });
      toast.success('Backup started');
      queryClient.invalidateQueries({ queryKey: ['project-backups'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Backup failed');
    } finally {
      setCreatingBackup(false);
    }
  }

  async function restoreBackup(backupId) {
    if (!confirm('Restore this backup? This will overwrite the current database with the backup data.')) return;
    if (!confirm('Are you absolutely sure? Current data will be replaced.')) return;
    setRestoringId(backupId);
    try {
      await api.post(`${base}/backups/${backupId}/restore`);
      toast.success('Database restored from backup!');
      queryClient.invalidateQueries({ queryKey: ['project-backups'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  }

  async function deleteBackup(backupId) {
    if (!confirm('Delete this backup permanently?')) return;
    try {
      await api.delete(`${base}/backups/${backupId}`);
      toast.success('Backup deleted');
      queryClient.invalidateQueries({ queryKey: ['project-backups'] });
    } catch {
      toast.error('Failed to delete');
    }
  }

  async function downloadBackup(backupId, filename) {
    try {
      const response = await api.get(`${base}/backups/${backupId}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  }

  function formatSize(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function timeAgo(date) {
    if (!date) return '';
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    const d = Math.floor(s / 86400);
    return d < 30 ? `${d}d ago` : new Date(date).toLocaleDateString();
  }

  const backups = backupData?.backups || [];
  const INTERVALS = [
    { id: 'hourly', label: 'Every Hour' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
  ];

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Backups</h3>
        </div>
        <Button size="sm" onClick={createBackup} disabled={creatingBackup}>
          {creatingBackup ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Play className="w-3 h-3 mr-1.5" />}
          {creatingBackup ? 'Creating...' : 'Backup Now'}
        </Button>
      </div>

      {/* Auto-backup schedule */}
      <div className="border rounded-lg p-3 mb-4 bg-muted/30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-medium">Automatic Backups</p>
            <p className="text-[10px] text-muted-foreground">Schedule regular backups with auto-cleanup</p>
          </div>
          {loadingSchedule ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <button
              onClick={() => saveSchedule({ enabled: !schedule.enabled })}
              disabled={savingSchedule}
              className={`relative w-9 h-5 rounded-full transition-colors ${schedule.enabled ? 'bg-primary' : 'bg-muted'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${schedule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          )}
        </div>

        {schedule.enabled && (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-[10px] text-muted-foreground">Frequency</Label>
              <select
                value={schedule.interval}
                onChange={e => saveSchedule({ interval: e.target.value })}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-background border rounded-md"
              >
                {INTERVALS.map(i => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <Label className="text-[10px] text-muted-foreground">Keep last</Label>
              <select
                value={schedule.keepCount}
                onChange={e => saveSchedule({ keepCount: parseInt(e.target.value) })}
                className="w-full mt-1 px-2 py-1.5 text-xs bg-background border rounded-md"
              >
                {[3, 5, 7, 10, 14, 30].map(n => (
                  <option key={n} value={n}>{n} backups</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Backup list */}
      {backupsLoading ? (
        <div className="text-center py-4"><LoadingSpinner /></div>
      ) : backups.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-20" />
          <p className="text-xs">No backups yet</p>
          <p className="text-[10px] text-muted-foreground/50">Click "Backup Now" or enable auto-backups</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
          {backups.map(b => (
            <div key={b.id} className="flex items-center gap-3 p-2.5 rounded-lg border bg-card text-xs">
              {/* Status icon */}
              <div className="shrink-0">
                {b.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> :
                 b.status === 'running' ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin" /> :
                 b.status === 'restored' ? <RotateCcw className="w-4 h-4 text-violet-400" /> :
                 <XCircle className="w-4 h-4 text-red-400" />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{b.backup_type} backup</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    b.status === 'completed' ? 'bg-emerald-500/15 text-emerald-500' :
                    b.status === 'running' ? 'bg-blue-500/15 text-blue-400' :
                    b.status === 'restored' ? 'bg-violet-500/15 text-violet-400' :
                    'bg-red-500/15 text-red-400'
                  }`}>{b.status}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{timeAgo(b.created_at)}</span>
                  {b.file_size_bytes > 0 && <span>{formatSize(b.file_size_bytes)}</span>}
                  {b.notes && <span className="truncate">{b.notes}</span>}
                </div>
              </div>

              {/* Actions */}
              {b.status === 'completed' && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => restoreBackup(b.id)}
                    disabled={restoringId === b.id}
                    className="p-1.5 rounded-md hover:bg-violet-500/10 text-muted-foreground hover:text-violet-400 transition-colors"
                    title="Restore this backup"
                  >
                    {restoringId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => downloadBackup(b.id, b.filename)}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteBackup(b.id)}
                    className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
