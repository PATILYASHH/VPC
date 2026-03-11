import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Play, Square, RotateCcw, Rocket, GitBranch, Globe, Terminal, Settings, ExternalLink,
  Loader2, Copy, ChevronDown, Plus, Trash2, Save, RefreshCw, Link, CheckCircle2, AlertCircle,
  Shield, Pencil
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
          <TabsTrigger value="domain">Domain</TabsTrigger>
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

        {/* Custom Domain */}
        <TabsContent value="domain" className="flex-1 overflow-auto p-4">
          <DomainSettings project={project} onSaved={refetch} />
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

// Bug #13: Helper to show auto-detected badge next to fields
function AutoBadge({ value, defaultValue }) {
  // Show badge if the value looks like it was auto-detected (not default and not empty)
  if (!value || value === defaultValue) return null;
  return (
    <Badge variant="outline" className="text-[9px] ml-1.5 px-1 py-0 border-blue-500/40 text-blue-500">
      auto
    </Badge>
  );
}

function SettingsForm({ project, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  // Bug #13: Rescan repo to update auto-detected values
  const handleScan = async () => {
    setScanning(true);
    try {
      const { data: scanResult } = await api.post(`/admin/web-hosting/projects/${project.id}/scan`);
      if (scanResult?.detected) {
        const d = scanResult.detected;
        const newForm = { ...form };
        if (d.installCommand) newForm.installCommand = d.installCommand;
        if (d.buildCommand) newForm.buildCommand = d.buildCommand;
        if (d.outputDir) newForm.outputDir = d.outputDir;
        if (d.nodeEntryPoint) newForm.nodeEntryPoint = d.nodeEntryPoint;
        setForm(newForm);
        toast.success(`Detected: ${d.framework || 'standard'} project${d.frontendDir ? ` (frontend: /${d.frontendDir})` : ''}${d.backendDir ? ` (backend: /${d.backendDir})` : ''}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const isNode = project?.project_type === 'node' || project?.project_type === 'fullstack';

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Settings className="w-4 h-4" /> Project Settings
        </h3>
        <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
          {scanning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
          Re-scan Repo
        </Button>
      </div>
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
            <Label className="text-xs flex items-center">
              Install Command
              <AutoBadge value={form.installCommand} defaultValue="npm install" />
            </Label>
            <Input value={form.installCommand || ''} onChange={e => setForm(f => ({ ...f, installCommand: e.target.value }))} className="text-sm font-mono" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              Build Command
              <AutoBadge value={form.buildCommand} defaultValue="" />
            </Label>
            <Input value={form.buildCommand || ''} onChange={e => setForm(f => ({ ...f, buildCommand: e.target.value }))} placeholder="npm run build" className="text-sm font-mono" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center">
            Output Directory
            <AutoBadge value={form.outputDir} defaultValue="" />
          </Label>
          <Input value={form.outputDir || ''} onChange={e => setForm(f => ({ ...f, outputDir: e.target.value }))} placeholder="dist" className="text-sm font-mono" />
        </div>
        {isNode && (
          <div className="space-y-1">
            <Label className="text-xs flex items-center">
              Node Entry Point
              <AutoBadge value={form.nodeEntryPoint} defaultValue="index.js" />
            </Label>
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

function DomainSettings({ project, onSaved }) {
  const [editing, setEditing] = useState(!project?.custom_domain);
  const [domain, setDomain] = useState(project?.custom_domain || '');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState(null);

  useEffect(() => {
    setDomain(project?.custom_domain || '');
    setEditing(!project?.custom_domain);
    setVerifyError(null);
  }, [project?.id, project?.custom_domain]);

  const handleSave = async () => {
    const cleaned = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    setSaving(true);
    try {
      await api.put(`/admin/web-hosting/projects/${project.id}`, { customDomain: cleaned || null });
      toast.success(cleaned ? `Domain "${cleaned}" saved` : 'Custom domain removed');
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save domain');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await api.delete(`/admin/web-hosting/projects/${project.id}/domain`);
      toast.success('Custom domain removed');
      setDomain('');
      setEditing(true);
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove domain');
    } finally {
      setRemoving(false);
    }
  };

  const handleGenerateToken = async () => {
    setGenerating(true);
    setVerifyError(null);
    try {
      await api.post(`/admin/web-hosting/projects/${project.id}/domain/verify-token`);
      toast.success('Verification token generated');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate token');
    } finally {
      setGenerating(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      await api.post(`/admin/web-hosting/projects/${project.id}/domain/verify`);
      toast.success('Domain verified successfully!');
      onSaved();
    } catch (err) {
      setVerifyError(err.response?.data?.error || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const hasDomain = !!project?.custom_domain;
  const isVerified = !!project?.domain_verified;
  const token = project?.domain_verify_token;

  const displayDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const isRootDomain = displayDomain && !displayDomain.startsWith('www.');
  const rootDomain = isRootDomain ? displayDomain : displayDomain.replace(/^www\./, '');

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-2 mb-1">
          <Link className="w-4 h-4" /> Custom Domain
        </h3>
        <p className="text-xs text-muted-foreground">Point your own domain to this project.</p>
      </div>

      {/* Current domain status bar */}
      {hasDomain && !editing && (
        <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
          {isVerified
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
          }
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-mono truncate">{project.custom_domain}</p>
              <Badge
                variant="outline"
                className={`text-[10px] ${isVerified ? 'border-emerald-500/50 text-emerald-500' : 'border-amber-500/50 text-amber-500'}`}
              >
                {isVerified ? 'Verified' : 'Unverified'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <a href={`http://${project.custom_domain}`} target="_blank" rel="noopener noreferrer" title="Open site">
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
            </a>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs px-2"
              onClick={() => { setDomain(project.custom_domain); setEditing(true); setVerifyError(null); }}
              title="Edit domain"
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive"
              onClick={handleRemove} disabled={removing} title="Remove domain"
            >
              {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      )}

      {/* Domain input (edit mode or no domain set) */}
      {editing && (
        <div className="space-y-2">
          <Label className="text-xs">{hasDomain ? 'Edit Domain' : 'Domain'}</Label>
          <div className="flex gap-2">
            <Input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="mysite.com or sub.mysite.com"
              className="text-sm font-mono"
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
            {hasDomain && (
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setDomain(project.custom_domain); }}>
                Cancel
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">Enter without https:// — e.g. <span className="font-mono">mysite.com</span></p>
        </div>
      )}

      {/* Verification section — only shown when domain set, not editing, not verified */}
      {hasDomain && !editing && !isVerified && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 border-b">
            <h4 className="text-xs font-semibold flex items-center gap-2">
              <Shield className="w-3.5 h-3.5" /> Verify Domain Ownership
            </h4>
          </div>
          <div className="p-4 space-y-3 text-xs text-muted-foreground">
            <p>
              Add a DNS TXT record to prove you own <span className="font-mono text-foreground">{project.custom_domain}</span>.
            </p>

            {!token ? (
              <Button size="sm" variant="outline" onClick={handleGenerateToken} disabled={generating}>
                {generating
                  ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                }
                Generate Verification Token
              </Button>
            ) : (
              <>
                <p>Add this TXT record in your DNS provider (Hostinger, GoDaddy, Cloudflare, etc.):</p>
                <div className="bg-zinc-950 rounded-md p-3 font-mono space-y-2">
                  <div className="grid grid-cols-[50px_1fr] gap-x-4 gap-y-1.5 text-[10px]">
                    <span className="text-zinc-400">Type</span>
                    <span className="text-blue-400">TXT</span>
                    <span className="text-zinc-400">Name</span>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-amber-400 break-all">_vpc-verify.{project.custom_domain}</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(`_vpc-verify.${project.custom_domain}`); toast.success('Copied'); }}
                        className="shrink-0 ml-1"
                      >
                        <Copy className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                      </button>
                    </div>
                    <span className="text-zinc-400">Value</span>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-emerald-400 break-all">{token}</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(token); toast.success('Copied'); }}
                        className="shrink-0 ml-1"
                      >
                        <Copy className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                      </button>
                    </div>
                  </div>
                </div>

                {verifyError && (
                  <div className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{verifyError}</span>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button size="sm" onClick={handleVerify} disabled={verifying}>
                    {verifying
                      ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    }
                    {verifying ? 'Checking DNS...' : 'Verify Now'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleGenerateToken} disabled={generating}>
                    <RefreshCw className="w-3 h-3 mr-1.5" /> Regenerate
                  </Button>
                </div>
                <p className="text-[10px]">DNS changes can take up to 48 hours to propagate. If verification fails, wait and try again.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Verified confirmation */}
      {hasDomain && !editing && isVerified && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-emerald-500">Domain verified</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              DNS ownership confirmed. Your site is accessible at <span className="font-mono">{project.custom_domain}</span>.
            </p>
          </div>
        </div>
      )}

      {/* DNS Setup Instructions */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted/50 px-4 py-2 border-b">
          <h4 className="text-xs font-semibold flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" /> DNS Setup Instructions
          </h4>
        </div>
        <div className="p-4 space-y-4 text-xs">
          <p className="text-muted-foreground">
            Log in to your DNS provider (Hostinger, GoDaddy, Cloudflare, etc.) and add these records:
          </p>

          <div className="space-y-2">
            <p className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
              {displayDomain ? `For ${rootDomain || 'your-root-domain.com'}` : 'For root domain (e.g. mysite.com)'}
            </p>
            <div className="bg-zinc-950 rounded-md p-3 font-mono space-y-1.5">
              <div className="grid grid-cols-[60px_50px_1fr_80px] gap-2 text-zinc-400 text-[10px] border-b border-zinc-800 pb-1.5">
                <span>Type</span><span>Name</span><span>Value</span><span>TTL</span>
              </div>
              <div className="grid grid-cols-[60px_50px_1fr_80px] gap-2 text-zinc-100 text-[10px]">
                <span className="text-blue-400">A</span>
                <span>@</span>
                <span className="text-amber-400">YOUR_SERVER_IP</span>
                <span className="text-zinc-400">3600</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-medium text-muted-foreground uppercase tracking-wider text-[10px]">
              {displayDomain ? `For www.${rootDomain || 'your-root-domain.com'} (optional)` : 'For www subdomain (optional)'}
            </p>
            <div className="bg-zinc-950 rounded-md p-3 font-mono space-y-1.5">
              <div className="grid grid-cols-[60px_50px_1fr_80px] gap-2 text-zinc-400 text-[10px] border-b border-zinc-800 pb-1.5">
                <span>Type</span><span>Name</span><span>Value</span><span>TTL</span>
              </div>
              <div className="grid grid-cols-[60px_50px_1fr_80px] gap-2 text-zinc-100 text-[10px]">
                <span className="text-blue-400">CNAME</span>
                <span>www</span>
                <span className="text-amber-400">{rootDomain || 'your-root-domain.com'}</span>
                <span className="text-zinc-400">3600</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1 text-muted-foreground">
              <p><span className="font-medium text-foreground">YOUR_SERVER_IP</span> — replace with your VPS public IP address.</p>
              <p>DNS changes can take <span className="font-medium text-foreground">up to 48 hours</span> to propagate worldwide.</p>
              <p>For SSL (HTTPS), use <span className="font-medium text-foreground">Cloudflare</span> as a proxy in front of your server.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
