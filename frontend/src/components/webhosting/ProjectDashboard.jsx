import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Play, Square, RotateCcw, Rocket, GitBranch, Globe, Terminal, Settings, ExternalLink,
  Loader2, Copy, ChevronDown, Plus, Trash2, Save, RefreshCw
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';

export default function ProjectDashboard({ project: initialProject, onBack }) {
  const queryClient = useQueryClient();
  const [deploying, setDeploying] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  const { data: project, refetch } = useApiQuery(
    ['wh-project', initialProject.id],
    `/admin/web-hosting/projects/${initialProject.id}`,
    { initialData: initialProject, refetchInterval: 5000 }
  );

  const projectUrl = `${window.location.origin}/${project?.slug || initialProject.slug}`;
  const isNode = project?.project_type === 'node' || project?.project_type === 'fullstack';

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const endpoint = project.last_deploy_at ? 'redeploy' : 'deploy';
      await api.post(`/admin/web-hosting/projects/${project.id}/${endpoint}`);
      toast.success('Deployment completed');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['wh-projects'] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Deployment failed');
    } finally {
      setDeploying(false);
    }
  };

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      await api.post(`/admin/web-hosting/projects/${project.id}/${action}`);
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} successful`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (s) => {
    if (s === 'running') return 'text-emerald-500';
    if (s === 'deploying') return 'text-amber-500';
    if (s === 'error') return 'text-red-500';
    return 'text-zinc-400';
  };

  const statusDot = (s) => {
    if (s === 'running') return 'bg-emerald-500';
    if (s === 'deploying') return 'bg-amber-500 animate-pulse';
    if (s === 'error') return 'bg-red-500';
    return 'bg-zinc-400';
  };

  return (
    <div className="flex-1 overflow-auto">
      <Tabs defaultValue="overview" className="h-full flex flex-col">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deploy-log">Deploy Log</TabsTrigger>
          {isNode && <TabsTrigger value="logs">Logs</TabsTrigger>}
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="flex-1 overflow-auto p-4 space-y-4">
          {/* Status Card */}
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${statusDot(project?.status)}`} />
                <div>
                  <h3 className="font-semibold text-sm">{project?.name}</h3>
                  <span className={`text-xs font-medium ${statusColor(project?.status)}`}>
                    {project?.status?.toUpperCase()}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{project?.project_type}</Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground block">URL</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <a href={projectUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono truncate text-[11px]">
                    /{project?.slug}
                  </a>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { navigator.clipboard.writeText(projectUrl); toast.success('URL copied'); }}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div>
                <span className="text-muted-foreground block">Branch</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <GitBranch className="w-3 h-3" />
                  <span className="font-mono">{project?.git_branch || 'main'}</span>
                </div>
              </div>
              {project?.node_port && (
                <div>
                  <span className="text-muted-foreground block">Port</span>
                  <span className="font-mono mt-0.5">{project.node_port}</span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground block">Last Deploy</span>
                <span className="font-mono mt-0.5">
                  {project?.last_deploy_at ? new Date(project.last_deploy_at).toLocaleString() : 'Never'}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleDeploy} disabled={deploying} size="sm">
              {deploying ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5 mr-1.5" />}
              {deploying ? 'Deploying...' : (project?.last_deploy_at ? 'Redeploy' : 'Deploy')}
            </Button>
            {isNode && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleAction('start')} disabled={actionLoading === 'start' || project?.status === 'running'}>
                  {actionLoading === 'start' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                  Start
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAction('stop')} disabled={actionLoading === 'stop' || project?.status === 'stopped'}>
                  {actionLoading === 'stop' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Square className="w-3.5 h-3.5 mr-1.5" />}
                  Stop
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleAction('restart')} disabled={actionLoading === 'restart'}>
                  {actionLoading === 'restart' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
                  Restart
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" asChild>
              <a href={projectUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Open Site
              </a>
            </Button>
          </div>

          {/* Git Info */}
          {project?.git_url && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Repository</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground break-all">{project.git_url}</p>
              {project.git_token && <Badge variant="outline" className="text-[10px] mt-1">Token configured</Badge>}
            </div>
          )}
        </TabsContent>

        {/* Deploy Log */}
        <TabsContent value="deploy-log" className="flex-1 overflow-auto p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Deployment Log</h3>
            <Button variant="ghost" size="sm" onClick={refetch}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
            </Button>
          </div>
          <pre className="bg-zinc-950 text-zinc-100 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap">
            {project?.last_deploy_log || 'No deployment logs yet. Click Deploy to start.'}
          </pre>
        </TabsContent>

        {/* PM2 Logs */}
        {isNode && (
          <TabsContent value="logs" className="flex-1 overflow-auto p-4">
            <LogsViewer projectId={project?.id} />
          </TabsContent>
        )}

        {/* Settings */}
        <TabsContent value="settings" className="flex-1 overflow-auto p-4">
          <SettingsForm project={project} onSaved={refetch} />
        </TabsContent>

        {/* Environment Variables */}
        <TabsContent value="env" className="flex-1 overflow-auto p-4">
          <EnvEditor project={project} onSaved={refetch} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LogsViewer({ projectId }) {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/web-hosting/projects/${projectId}/logs?lines=200`);
      setLogs(data.combined || 'No logs available');
    } catch {
      setLogs('Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [projectId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Terminal className="w-4 h-4" /> PM2 Logs
        </h3>
        <Button variant="ghost" size="sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>
      <pre className="bg-zinc-950 text-zinc-100 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap">
        {logs}
      </pre>
    </div>
  );
}

function SettingsForm({ project, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setForm({
        gitUrl: project.git_url || '',
        gitToken: project.git_token || '',
        gitBranch: project.git_branch || 'main',
        buildCommand: project.build_command || '',
        installCommand: project.install_command || 'npm install',
        outputDir: project.output_dir || '',
        nodeEntryPoint: project.node_entry_point || 'index.js',
      });
    }
  }, [project?.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/web-hosting/projects/${project.id}`, form);
      toast.success('Settings saved');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const isNode = project?.project_type === 'node' || project?.project_type === 'fullstack';

  return (
    <div className="space-y-4 max-w-lg">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Settings className="w-4 h-4" /> Project Settings
      </h3>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Git Repository URL</Label>
          <Input value={form.gitUrl || ''} onChange={e => setForm(f => ({ ...f, gitUrl: e.target.value }))} className="text-sm font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Access Token</Label>
            <Input type="password" value={form.gitToken || ''} onChange={e => setForm(f => ({ ...f, gitToken: e.target.value }))} placeholder="ghp_xxxx" className="text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Input value={form.gitBranch || ''} onChange={e => setForm(f => ({ ...f, gitBranch: e.target.value }))} className="text-sm font-mono" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Install Command</Label>
            <Input value={form.installCommand || ''} onChange={e => setForm(f => ({ ...f, installCommand: e.target.value }))} className="text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Build Command</Label>
            <Input value={form.buildCommand || ''} onChange={e => setForm(f => ({ ...f, buildCommand: e.target.value }))} placeholder="npm run build" className="text-sm font-mono" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Output Directory</Label>
          <Input value={form.outputDir || ''} onChange={e => setForm(f => ({ ...f, outputDir: e.target.value }))} placeholder="dist" className="text-sm font-mono" />
        </div>
        {isNode && (
          <div className="space-y-1">
            <Label className="text-xs">Node Entry Point</Label>
            <Input value={form.nodeEntryPoint || ''} onChange={e => setForm(f => ({ ...f, nodeEntryPoint: e.target.value }))} placeholder="index.js" className="text-sm font-mono" />
          </div>
        )}
      </div>
      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        Save Settings
      </Button>
    </div>
  );
}

function EnvEditor({ project, onSaved }) {
  const [envVars, setEnvVars] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project?.env_vars) {
      const entries = Object.entries(project.env_vars).map(([key, value]) => ({ key, value }));
      setEnvVars(entries.length > 0 ? entries : [{ key: '', value: '' }]);
    } else {
      setEnvVars([{ key: '', value: '' }]);
    }
  }, [project?.id]);

  const addRow = () => setEnvVars(prev => [...prev, { key: '', value: '' }]);
  const removeRow = (idx) => setEnvVars(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx, field, val) => setEnvVars(prev => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row));

  const handleSave = async () => {
    setSaving(true);
    try {
      const envObj = {};
      envVars.forEach(({ key, value }) => { if (key.trim()) envObj[key.trim()] = value; });
      await api.put(`/admin/web-hosting/projects/${project.id}`, { envVars: envObj });
      toast.success('Environment variables saved. Redeploy to apply.');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Environment Variables</h3>
        <Button variant="ghost" size="sm" onClick={addRow}><Plus className="w-3.5 h-3.5 mr-1" /> Add</Button>
      </div>
      <div className="space-y-2">
        {envVars.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input value={row.key} onChange={e => updateRow(idx, 'key', e.target.value)} placeholder="KEY" className="text-sm font-mono flex-1" />
            <Input value={row.value} onChange={e => updateRow(idx, 'value', e.target.value)} placeholder="value" className="text-sm font-mono flex-[2]" />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(idx)}>
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">Changes require a redeploy to take effect. PORT is automatically set for Node.js projects.</p>
      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
        Save Variables
      </Button>
    </div>
  );
}
