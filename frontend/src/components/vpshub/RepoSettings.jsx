import { useState, useEffect, useRef } from 'react';
import { Database, Link2, Unlink, Play, CheckCircle2, XCircle, Clock, FileCode, RefreshCw, Zap, Globe, Server, Square, RotateCcw, Terminal, Loader2, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';

function timeAgo(date) {
  if (!date) return 'never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(date).toLocaleDateString();
}

const statusStyles = {
  applied: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
  failed: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  skipped: { icon: CheckCircle2, color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
};

export default function RepoSettings({ owner, repo }) {
  const [projects, setProjects] = useState([]);
  const [linkedProject, setLinkedProject] = useState(null);
  const [migrations, setMigrations] = useState([]);
  const [detected, setDetected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  // Hosting state
  const [hostingProjects, setHostingProjects] = useState([]);
  const [linkedHosting, setLinkedHosting] = useState(null);
  const [hostingStatus, setHostingStatus] = useState(null);
  const [hostingLogs, setHostingLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [hostingLinking, setHostingLinking] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [selectedHostingId, setSelectedHostingId] = useState('');
  const [creatingHosting, setCreatingHosting] = useState(false);
  const [newHosting, setNewHosting] = useState({ name: '', type: 'static', buildCommand: '' });
  const [showCreateHosting, setShowCreateHosting] = useState(false);
  const logsEndRef = useRef(null);

  useEffect(() => { loadData(); }, [owner, repo]);

  async function loadData() {
    setLoading(true);
    try {
      const [projectsRes, linkedRes, hostingProjectsRes, linkedHostingRes] = await Promise.all([
        api.get('/admin/vpshub/projects'),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/linked-db`),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/hosting-projects`).catch(() => ({ data: { projects: [] } })),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/linked-hosting`).catch(() => ({ data: { hosting: null, status: null } })),
      ]);
      setProjects(projectsRes.data.projects);
      setLinkedProject(linkedRes.data.project);
      setMigrations(linkedRes.data.migrations);
      setDetected(linkedRes.data.detected);
      setHostingProjects(hostingProjectsRes.data.projects || []);
      setLinkedHosting(linkedHostingRes.data.hosting);
      setHostingStatus(linkedHostingRes.data.status);
    } catch (err) {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function handleLink() {
    if (!selectedProjectId) return;
    setLinking(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/link-db`, {
        projectId: selectedProjectId,
      });
      toast.success('Database linked!');
      setLinkedProject(data.project);
      setSelectedProjectId('');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to link database');
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/unlink-db`);
      toast.success('Database unlinked');
      setLinkedProject(null);
      setMigrations([]);
      loadData();
    } catch (err) {
      toast.error('Failed to unlink');
    }
  }

  async function handleRunAll() {
    setRunning(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/run-migrations`);
      const applied = data.results.filter(r => r.status === 'applied').length;
      const failed = data.results.filter(r => r.status === 'failed').length;
      const skipped = data.results.filter(r => r.status === 'skipped').length;

      if (failed > 0) {
        toast.error(`${failed} migration(s) failed. ${applied} applied, ${skipped} skipped.`);
      } else if (applied > 0) {
        toast.success(`${applied} migration(s) applied! ${skipped} skipped.`);
      } else {
        toast.info('All migrations already applied.');
      }
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run migrations');
    } finally {
      setRunning(false);
    }
  }

  async function handleRunSingle(filePath, fileHash) {
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/run-migration`, {
        filePath, fileHash,
      });
      if (data.status === 'applied') {
        toast.success(`Applied: ${filePath}`);
      } else {
        toast.error(`Failed: ${data.message}`);
      }
      loadData();
    } catch (err) {
      toast.error('Failed to run migration');
    }
  }

  // Hosting handlers
  async function handleCreateHosting() {
    if (!newHosting.name) return;
    setCreatingHosting(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/create-hosting`, {
        name: newHosting.name,
        type: newHosting.type,
        buildCommand: newHosting.buildCommand,
      });
      toast.success('Hosting project created and linked!');
      setShowCreateHosting(false);
      setNewHosting({ name: '', type: 'static', buildCommand: '' });
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create hosting');
    } finally {
      setCreatingHosting(false);
    }
  }

  async function handleLinkHosting() {
    if (!selectedHostingId) return;
    setHostingLinking(true);
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/link-hosting`, {
        hostingId: selectedHostingId,
      });
      toast.success('Hosting linked!');
      setSelectedHostingId('');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to link hosting');
    } finally {
      setHostingLinking(false);
    }
  }

  async function handleUnlinkHosting() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/unlink-hosting`);
      toast.success('Hosting unlinked');
      setLinkedHosting(null);
      setHostingStatus(null);
      loadData();
    } catch (err) {
      toast.error('Failed to unlink hosting');
    }
  }

  async function handleDeploy() {
    setDeploying(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/deploy-hosting`);
      toast.success(data.message || 'Deployed successfully!');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  }

  async function handleHostingControl(action) {
    setControlling(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/hosting-control`, { action });
      toast.success(data.message || `${action} successful`);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${action}`);
    } finally {
      setControlling(false);
    }
  }

  async function fetchLogs() {
    try {
      const { data } = await api.get(`/admin/vpshub/repos/${owner}/${repo}/hosting-logs`);
      setHostingLogs(data.logs || 'No logs available');
      setShowLogs(true);
    } catch (err) {
      toast.error('Failed to fetch logs');
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;

  // Build migration display: combine detected files with applied status
  const appliedMap = new Map(migrations.map(m => [m.file_path, m]));
  const migrationFiles = detected.map(d => ({
    path: d.path,
    hash: d.hash,
    size: d.size,
    applied: appliedMap.get(d.path),
  }));

  const pendingCount = migrationFiles.filter(m => !m.applied || m.applied.status !== 'applied').length;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Database Connection */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Database className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Connected Database</h3>
        </div>

        <div className="p-4">
          {linkedProject ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Database className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{linkedProject.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{linkedProject.db_name}</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleUnlink} className="text-red-500 hover:text-red-400">
                  <Unlink className="w-3.5 h-3.5 mr-1" /> Unlink
                </Button>
              </div>

              <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                <Zap className="w-3.5 h-3.5" />
                Auto-deploy enabled: migrations run automatically when you push code
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Link a BanaDB project to auto-deploy migrations when you push code.
              </p>
              <div className="flex gap-2">
                <select
                  value={selectedProjectId}
                  onChange={e => setSelectedProjectId(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm bg-background border rounded-md"
                >
                  <option value="">Select a project...</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.db_name})</option>
                  ))}
                </select>
                <Button size="sm" onClick={handleLink} disabled={!selectedProjectId || linking}>
                  <Link2 className="w-4 h-4 mr-1" /> {linking ? 'Linking...' : 'Link'}
                </Button>
              </div>
              {projects.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No BanaDB projects found. Create one in the BanaDB section first.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Migrations */}
      {linkedProject && (
        <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">Migrations</h3>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 text-xs bg-yellow-500/15 text-yellow-500 rounded-full border border-yellow-500/30">
                  {pendingCount} pending
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadData}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
              </Button>
              {pendingCount > 0 && (
                <Button size="sm" onClick={handleRunAll} disabled={running}>
                  <Play className="w-3.5 h-3.5 mr-1" /> {running ? 'Running...' : 'Run All'}
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y">
            {migrationFiles.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No migration files found. Add SQL files to a <code className="bg-accent px-1 rounded">migrations/</code> folder in your repo.
              </div>
            ) : migrationFiles.map(m => {
              const status = m.applied?.status || 'pending';
              const Style = statusStyles[status] || statusStyles.pending;
              const Icon = Style.icon;

              return (
                <div key={m.path} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={`w-4 h-4 ${Style.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate">{m.path}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.size ? `${(m.size / 1024).toFixed(1)} KB` : ''}
                      {m.applied?.applied_at && ` · applied ${timeAgo(m.applied.applied_at)}`}
                      {m.applied?.error_message && (
                        <span className="text-red-400"> · {m.applied.error_message.substring(0, 80)}</span>
                      )}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${Style.bg} ${Style.color}`}>{status}</span>
                  {(status === 'pending' || status === 'failed') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleRunSingle(m.path, m.hash)}
                    >
                      <Play className="w-3 h-3 mr-1" /> Run
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Available Projects List */}
      {!linkedProject && projects.length > 0 && (
        <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Database className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Available Projects</h3>
          </div>
          <div className="divide-y">
            {projects.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{p.db_name}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedProjectId(p.id);
                    handleLink();
                  }}
                >
                  <Link2 className="w-3.5 h-3.5 mr-1" /> Connect
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Web Hosting */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Globe className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Web Hosting</h3>
        </div>

        <div className="p-4">
          {linkedHosting ? (
            <div className="space-y-4">
              {/* Linked hosting info */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Server className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{linkedHosting.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {linkedHosting.type === 'static' ? 'Static Site' : linkedHosting.type === 'node' ? 'Node.js App' : 'Fullstack App'}
                      {linkedHosting.slug && (
                        <span className="ml-2 font-mono">/{linkedHosting.slug}</span>
                      )}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleUnlinkHosting} className="text-red-500 hover:text-red-400">
                  <Unlink className="w-3.5 h-3.5 mr-1" /> Unlink
                </Button>
              </div>

              {/* Auto-deploy notice */}
              <div className="flex items-center gap-2 p-2 rounded bg-blue-500/10 border border-blue-500/20 text-xs text-blue-500">
                <Zap className="w-3.5 h-3.5" />
                Auto-deploy enabled: hosting redeploys automatically when you push code
              </div>

              {/* Status + Controls */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    hostingStatus?.status === 'online' ? 'bg-green-500 animate-pulse' :
                    hostingStatus?.status === 'stopped' ? 'bg-zinc-400' :
                    hostingStatus?.status === 'errored' ? 'bg-red-500' :
                    'bg-yellow-500 animate-pulse'
                  }`} />
                  <span className="text-sm font-medium capitalize">
                    {hostingStatus?.status || 'Unknown'}
                  </span>
                  {hostingStatus?.uptime && (
                    <span className="text-xs text-muted-foreground">
                      Uptime: {hostingStatus.uptime}
                    </span>
                  )}
                  {hostingStatus?.memory && (
                    <span className="text-xs text-muted-foreground">
                      RAM: {hostingStatus.memory}
                    </span>
                  )}
                </div>

                <div className="flex gap-1.5">
                  {linkedHosting.url && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                      <a href={linkedHosting.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3 h-3 mr-1" /> Visit
                      </a>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleDeploy}
                    disabled={deploying}
                  >
                    {deploying ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    {deploying ? 'Deploying...' : 'Deploy'}
                  </Button>
                  {linkedHosting.type !== 'static' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleHostingControl('restart')}
                        disabled={controlling}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" /> Restart
                      </Button>
                      {hostingStatus?.status === 'online' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-red-500"
                          onClick={() => handleHostingControl('stop')}
                          disabled={controlling}
                        >
                          <Square className="w-3 h-3 mr-1" /> Stop
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-green-500"
                          onClick={() => handleHostingControl('start')}
                          disabled={controlling}
                        >
                          <Play className="w-3 h-3 mr-1" /> Start
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Logs */}
              <div>
                <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  {showLogs ? 'Refresh Logs' : 'View Logs'}
                </Button>
                {showLogs && (
                  <div className="mt-2 bg-zinc-950 border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                      <span className="text-xs text-zinc-400 font-mono">Deploy Logs</span>
                      <button onClick={() => setShowLogs(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
                        Close
                      </button>
                    </div>
                    <pre className="p-3 text-xs font-mono text-zinc-300 overflow-auto max-h-64 whitespace-pre-wrap">
                      {hostingLogs}
                      <span ref={logsEndRef} />
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect a hosting project to auto-deploy when you push code.
              </p>

              {/* Link existing */}
              {hostingProjects.length > 0 && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Link existing hosting project</label>
                  <div className="flex gap-2">
                    <select
                      value={selectedHostingId}
                      onChange={e => setSelectedHostingId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm bg-background border rounded-md"
                    >
                      <option value="">Select a hosting project...</option>
                      {hostingProjects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type === 'static' ? 'Static' : p.type === 'node' ? 'Node.js' : 'Fullstack'})
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={handleLinkHosting} disabled={!selectedHostingId || hostingLinking}>
                      <Link2 className="w-4 h-4 mr-1" /> {hostingLinking ? 'Linking...' : 'Link'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Divider */}
              {hostingProjects.length > 0 && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 border-t" />
                </div>
              )}

              {/* Create new */}
              {!showCreateHosting ? (
                <Button variant="outline" size="sm" onClick={() => setShowCreateHosting(true)} className="gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Create New Hosting Project
                </Button>
              ) : (
                <div className="border rounded-lg p-4 space-y-3 bg-background">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Project Name</label>
                    <input
                      type="text"
                      value={newHosting.name}
                      onChange={e => setNewHosting(h => ({ ...h, name: e.target.value }))}
                      placeholder="my-website"
                      className="w-full px-3 py-2 text-sm bg-card border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Project Type</label>
                    <select
                      value={newHosting.type}
                      onChange={e => setNewHosting(h => ({ ...h, type: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-card border rounded-md"
                    >
                      <option value="static">Static Site (HTML/CSS/JS)</option>
                      <option value="node">Node.js Application</option>
                      <option value="fullstack">Fullstack (Node.js + Static)</option>
                    </select>
                  </div>
                  {newHosting.type !== 'static' && (
                    <div>
                      <label className="text-xs font-medium mb-1 block">Build Command (optional)</label>
                      <input
                        type="text"
                        value={newHosting.buildCommand}
                        onChange={e => setNewHosting(h => ({ ...h, buildCommand: e.target.value }))}
                        placeholder="npm install && npm run build"
                        className="w-full px-3 py-2 text-sm bg-card border rounded-md font-mono"
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateHosting} disabled={!newHosting.name || creatingHosting}>
                      {creatingHosting ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
                      {creatingHosting ? 'Creating...' : 'Create & Link'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowCreateHosting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
