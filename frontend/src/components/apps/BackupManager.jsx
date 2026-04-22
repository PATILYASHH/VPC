import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Play, Download, RotateCcw, Trash2, HardDrive, Database, Clock,
  CheckCircle2, XCircle, Loader2, Shield, Calendar, Settings,
  AlertTriangle, Plus, ChevronRight, Server, ArrowRight, X
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import BackupDestinations from './BackupDestinations';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function timeAgo(date) {
  if (!date) return 'Never';
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(date).toLocaleDateString();
}

function nextBackupTime(lastDate, interval) {
  if (!lastDate) return 'Now (pending)';
  const intervals = { hourly: 3600000, daily: 86400000, weekly: 604800000, monthly: 2592000000 };
  const ms = intervals[interval] || intervals.daily;
  const next = new Date(new Date(lastDate).getTime() + ms);
  if (next < new Date()) return 'Due now';
  const diff = next.getTime() - Date.now();
  if (diff < 3600000) return `in ${Math.ceil(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.ceil(diff / 3600000)}h`;
  return `in ${Math.ceil(diff / 86400000)}d`;
}

const INTERVALS = [
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

export default function BackupManager() {
  const [activeView, setActiveView] = useState('overview'); // overview | detail
  const [selectedProject, setSelectedProject] = useState(null); // null = system, or project obj
  const queryClient = useQueryClient();

  const { data: projectsData } = useApiQuery('db-projects', '/admin/db/projects');
  const projects = projectsData?.projects || [];

  // System backups
  const { data: systemBackups, isLoading: sysLoading } = useApiQuery('system-backups', '/admin/backup/list', { refetchInterval: 10000 });

  if (activeView === 'detail') {
    return (
      <BackupDetail
        project={selectedProject}
        onBack={() => { setActiveView('overview'); setSelectedProject(null); }}
      />
    );
  }

  const sysBackups = systemBackups?.backups || [];
  const lastSysBackup = sysBackups.find(b => b.status === 'completed');
  const sysSize = sysBackups.reduce((s, b) => s + (b.file_size_bytes || 0), 0);

  return (
    <div className="h-full flex flex-col surface-0">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--surface-border)' }}>
        <div className="flex items-center gap-3 mb-1">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Backup Manager</h1>
        </div>
        <p className="text-xs text-muted-foreground">Manage backups for system and project databases</p>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* ─── System Backup ─── */}
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">System Database</h2>
          <div
            onClick={() => { setSelectedProject(null); setActiveView('detail'); }}
            className="border rounded-xl p-4 bg-card cursor-pointer hover:border-primary/30 transition-all group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">VPC System Database</h3>
                  <Badge variant="outline" className="text-[9px]">vpc</Badge>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> {sysBackups.length} backup{sysBackups.length !== 1 ? 's' : ''}
                  </span>
                  <span>{formatBytes(sysSize)} total</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Last: {lastSysBackup ? timeAgo(lastSysBackup.created_at) : 'Never'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lastSysBackup ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </div>
            </div>
          </div>
        </div>

        {/* ─── Cloud Destinations (Supabase, etc.) ─── */}
        <BackupDestinations />

        {/* ─── Project Databases ─── */}
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            Project Databases ({projects.length})
          </h2>
          {projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-xs">No DB projects yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {projects.map(proj => (
                <ProjectBackupCard
                  key={proj.id}
                  project={proj}
                  onClick={() => { setSelectedProject(proj); setActiveView('detail'); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Project Backup Card ─────────────────────────────────────

function ProjectBackupCard({ project, onClick }) {
  const [schedule, setSchedule] = useState(null);
  const [lastBackup, setLastBackup] = useState(null);
  const [backupCount, setBackupCount] = useState(0);
  const [totalSize, setTotalSize] = useState(0);

  useEffect(() => {
    // Load backup info
    api.get(`/admin/db/projects/${project.id}/backups`).then(({ data }) => {
      const backups = data.backups || [];
      setBackupCount(backups.length);
      setTotalSize(backups.reduce((s, b) => s + (b.file_size_bytes || 0), 0));
      setLastBackup(backups.find(b => b.status === 'completed') || null);
    }).catch(() => {});

    api.get(`/admin/db/projects/${project.id}/backup-schedule`).then(({ data }) => {
      setSchedule(data);
    }).catch(() => {});
  }, [project.id]);

  const hasSchedule = schedule?.enabled;

  return (
    <div
      onClick={onClick}
      className="border rounded-xl p-4 bg-card cursor-pointer hover:border-primary/30 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
          <Database className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{project.name}</h3>
            {hasSchedule && (
              <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30 text-[8px]">
                AUTO
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground font-mono">{project.db_name}</p>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-2">
            <span className="flex items-center gap-1">
              <HardDrive className="w-2.5 h-2.5" />
              {backupCount} backup{backupCount !== 1 ? 's' : ''}
            </span>
            <span>{formatBytes(totalSize)}</span>
          </div>

          {/* Status row */}
          <div className="flex items-center gap-3 text-[10px] mt-1.5">
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              Last: {lastBackup ? timeAgo(lastBackup.created_at) : <span className="text-amber-400">Never</span>}
            </span>
            {hasSchedule && lastBackup && (
              <span className="text-violet-400 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />
                Next: {nextBackupTime(lastBackup.created_at, schedule.interval)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-1">
          {lastBackup ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
          <ChevronRight className="w-4 h-4 text-muted-foreground/20 group-hover:text-muted-foreground/50 transition-colors" />
        </div>
      </div>
    </div>
  );
}

// ─── Backup Detail View ──────────────────────────────────────

function BackupDetail({ project, onBack }) {
  const [running, setRunning] = useState(false);
  const [backupType, setBackupType] = useState('full');
  const [restoringId, setRestoringId] = useState(null);
  const [schedule, setSchedule] = useState({ enabled: false, interval: 'daily', keepCount: 7 });
  const [showSettings, setShowSettings] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const queryClient = useQueryClient();

  const isSystem = !project;
  const label = isSystem ? 'VPC System Database' : project.name;
  const dbName = isSystem ? 'vpc' : project.db_name;

  const backupsUrl = isSystem ? '/admin/backup/list' : `/admin/db/projects/${project.id}/backups`;
  const { data: backupData, isLoading } = useApiQuery(['detail-backups', project?.id || 'vpc'], backupsUrl, { refetchInterval: 5000 });
  const backups = backupData?.backups || [];

  useEffect(() => {
    if (isSystem) return;
    api.get(`/admin/db/projects/${project.id}/backup-schedule`)
      .then(({ data }) => setSchedule(data)).catch(() => {});
  }, [project?.id]);

  async function saveSchedule(updates) {
    if (isSystem) return;
    const s = { ...schedule, ...updates };
    setSchedule(s);
    setSavingSchedule(true);
    try {
      await api.post(`/admin/db/projects/${project.id}/backup-schedule`, s);
      toast.success(s.enabled ? `Auto-backup: ${s.interval}` : 'Auto-backup disabled');
    } catch { toast.error('Failed'); }
    finally { setSavingSchedule(false); }
  }

  async function runBackup() {
    setRunning(true);
    try {
      if (isSystem) await api.post('/admin/backup/run', { backup_type: backupType });
      else await api.post(`/admin/db/projects/${project.id}/backups`, { backupType });
      toast.success('Backup started');
      queryClient.invalidateQueries({ queryKey: ['detail-backups'] });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRunning(false); }
  }

  async function restore(id) {
    if (!confirm('Restore this backup? Current data will be OVERWRITTEN.')) return;
    if (!confirm('This cannot be undone. Continue?')) return;
    setRestoringId(id);
    try {
      if (isSystem) await api.post(`/admin/backup/restore/${id}`, { confirm: true });
      else await api.post(`/admin/db/projects/${project.id}/backups/${id}/restore`);
      toast.success('Restored!');
      queryClient.invalidateQueries({ queryKey: ['detail-backups'] });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setRestoringId(null); }
  }

  async function download(b) {
    try {
      const url = isSystem ? `/admin/backup/download/${b.id}` : `/admin/db/projects/${project.id}/backups/${b.id}/download`;
      const res = await api.get(url, { responseType: 'blob' });
      const u = window.URL.createObjectURL(res.data);
      const a = document.createElement('a'); a.href = u; a.download = b.filename || 'backup.sql.gz'; a.click();
      window.URL.revokeObjectURL(u);
    } catch { toast.error('Download failed'); }
  }

  async function remove(id) {
    if (!confirm('Delete this backup?')) return;
    try {
      const url = isSystem
        ? `/admin/backup/${id}`
        : `/admin/db/projects/${project.id}/backups/${id}`;
      await api.delete(url);
      toast.success('Deleted');
      queryClient.invalidateQueries({ queryKey: ['detail-backups'] });
    } catch { toast.error('Failed to delete backup'); }
  }

  const completed = backups.filter(b => b.status === 'completed');
  const totalSize = backups.reduce((s, b) => s + (b.file_size_bytes || 0), 0);
  const lastBackup = completed[0];

  return (
    <div className="h-full flex flex-col surface-0">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: 'var(--surface-border)' }}>
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3 transition-colors">
          <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Back
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSystem ? 'bg-primary/10' : 'bg-emerald-500/10'}`}>
              {isSystem ? <Server className="w-5 h-5 text-primary" /> : <Database className="w-5 h-5 text-emerald-400" />}
            </div>
            <div>
              <h2 className="text-base font-bold">{label}</h2>
              <p className="text-[10px] text-muted-foreground font-mono">{dbName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isSystem && (
              <Button size="sm" variant="outline" onClick={() => setShowSettings(!showSettings)} className="text-xs">
                <Settings className="w-3.5 h-3.5 mr-1.5" />
                {showSettings ? 'Hide' : 'Schedule'}
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <select value={backupType} onChange={e => setBackupType(e.target.value)} className="px-2 py-1.5 text-xs bg-background border rounded-lg">
                <option value="full">Full</option>
                <option value="schema_only">Schema</option>
                <option value="data_only">Data</option>
              </select>
              <Button size="sm" onClick={runBackup} disabled={running}>
                {running ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                Backup Now
              </Button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mt-3 text-[11px] text-muted-foreground">
          <span>{backups.length} total</span>
          <span className="text-emerald-500">{completed.length} completed</span>
          <span>{formatBytes(totalSize)} stored</span>
          <span>Last: {lastBackup ? timeAgo(lastBackup.created_at) : 'Never'}</span>
          {!isSystem && schedule.enabled && (
            <span className="text-violet-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Auto: {schedule.interval} · Next: {nextBackupTime(lastBackup?.created_at, schedule.interval)}
            </span>
          )}
        </div>
      </div>

      {/* Schedule settings panel */}
      {showSettings && !isSystem && (
        <div className="px-5 py-3 border-b bg-card" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Auto-Backup</span>
              <button
                onClick={() => saveSchedule({ enabled: !schedule.enabled })}
                disabled={savingSchedule}
                className={`relative w-9 h-5 rounded-full transition-colors ${schedule.enabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${schedule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </div>
            {schedule.enabled && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Every</span>
                  {INTERVALS.map(i => (
                    <button
                      key={i.id}
                      onClick={() => saveSchedule({ interval: i.id })}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                        schedule.interval === i.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Keep</span>
                  <select
                    value={schedule.keepCount}
                    onChange={e => saveSchedule({ keepCount: parseInt(e.target.value) })}
                    className="px-2 py-1 text-[10px] bg-background border rounded-md"
                  >
                    {[3, 5, 7, 10, 14, 30].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-[10px] text-muted-foreground">backups</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Backup list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <HardDrive className="w-12 h-12 mb-3 opacity-10" />
            <p className="text-sm">No backups yet</p>
            <p className="text-xs text-muted-foreground/40 mt-1">Click "Backup Now" to create one</p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {backups.map(b => (
              <div key={b.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                <div className="shrink-0">
                  {b.status === 'completed' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> :
                   b.status === 'running' ? <Loader2 className="w-5 h-5 text-blue-400 animate-spin" /> :
                   b.status === 'restored' ? <RotateCcw className="w-5 h-5 text-violet-400" /> :
                   <XCircle className="w-5 h-5 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate">{b.backup_type} backup</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      b.status === 'completed' ? 'bg-emerald-500/15 text-emerald-500' :
                      b.status === 'running' ? 'bg-blue-500/15 text-blue-400' :
                      b.status === 'restored' ? 'bg-violet-500/15 text-violet-400' :
                      'bg-red-500/15 text-red-400'
                    }`}>{b.status}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                    <span>{timeAgo(b.created_at)}</span>
                    <span className="font-mono">{formatBytes(b.file_size_bytes)}</span>
                    {b.notes && <span className="truncate opacity-50">{b.notes}</span>}
                  </div>
                </div>
                {b.status === 'completed' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => restore(b.id)} disabled={restoringId === b.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors">
                      {restoringId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Rollback
                    </button>
                    <button onClick={() => download(b)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    {!isSystem && (
                      <button onClick={() => remove(b.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
