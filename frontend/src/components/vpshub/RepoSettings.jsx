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
        api.get('/admin/vpshub/hosting-projects').catch(() => ({ data: { projects: [] } })),
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

  async function handleLinkDb(projectId) {
    const id = projectId || selectedProjectId;
    if (!id) return;
    setLinking(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/link-db`, {
        projectId: id,
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

  async function handleCreateHosting() {
    if (!newHosting.name) return;
    setCreatingHosting(true);
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/create-hosting`, {
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

  // Build migration display
  const appliedMap = new Map(migrations.map(m => [m.file_path, m]));
  const migrationFiles = detected.map(d => ({
    path: d.path,
    hash: d.hash,
    size: d.size,
    applied: appliedMap.get(d.path),
  }));
  const pendingCount = migrationFiles.filter(m => !m.applied || m.applied.status !== 'applied').length;

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Database */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Database className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Database</h3>
        </div>

        <div className="p-4">
          {linkedProject ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Database className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{linkedProject.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{linkedProject.db_name}</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleUnlink} className="text-red-500 hover:text-red-400 h-7 text-xs">
                  <Unlink className="w-3 h-3 mr-1" /> Unlink
                </Button>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-green-500/10 border border-green-500/20 text-xs text-green-500">
                <Zap className="w-3 h-3" />
                Auto-deploy: migrations run on push
              </div>

              {/* Inline migrations */}
              {migrationFiles.length > 0 && (
                <div className="border border-white/[0.06] rounded-lg mt-2">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                    <div className="flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">Migrations</span>
                      {pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/15 text-yellow-500 rounded-full">
                          {pendingCount} pending
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={loadData} className="h-6 w-6 p-0">
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                      {pendingCount > 0 && (
                        <Button size="sm" onClick={handleRunAll} disabled={running} className="h-6 text-[10px] px-2">
                          <Play className="w-3 h-3 mr-1" /> {running ? 'Running...' : 'Run All'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="divide-y divide-white/[0.04] max-h-48 overflow-auto">
                    {migrationFiles.map(m => {
                      const status = m.applied?.status || 'pending';
                      const Style = statusStyles[status] || statusStyles.pending;
                      const Icon = Style.icon;
                      return (
                        <div key={m.path} className="flex items-center gap-2 px-3 py-2">
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${Style.color}`} />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-mono truncate">{m.path}</div>
                          </div>
                          <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${Style.bg} ${Style.color}`}>{status}</span>
                          {(status === 'pending' || status === 'failed') && (
                            <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleRunSingle(m.path, m.hash)}>
                              <Play className="w-2.5 h-2.5 mr-0.5" /> Run
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Link a DB project to auto-deploy migrations on push.
              </p>
              {projects.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    value={selectedProjectId}
                    onChange={e => setSelectedProjectId(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm bg-background border rounded-md"
                  >
                    <option value="">Select a project...</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.db_name})</option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => handleLinkDb()} disabled={!selectedProjectId || linking} className="h-8">
                    <Link2 className="w-3.5 h-3.5 mr-1" /> {linking ? 'Linking...' : 'Connect'}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No DB projects found. Create one in the DB section first.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hosting */}
      <div className="border border-white/[0.06] rounded-xl bg-white/[0.02]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Globe className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">Hosting</h3>
        </div>

        <div className="p-4">
          {linkedHosting ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Server className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{linkedHosting.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {linkedHosting.type === 'static' ? 'Static' : linkedHosting.type === 'node' ? 'Node.js' : 'Fullstack'}
                      {linkedHosting.slug && <span className="ml-1 font-mono">/{linkedHosting.slug}</span>}
                    </div>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleUnlinkHosting} className="text-red-500 hover:text-red-400 h-7 text-xs">
                  <Unlink className="w-3 h-3 mr-1" /> Unlink
                </Button>
              </div>

              {/* Status bar */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-background border">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    hostingStatus?.status === 'online' ? 'bg-green-500 animate-pulse' :
                    hostingStatus?.status === 'stopped' ? 'bg-zinc-400' :
                    hostingStatus?.status === 'errored' ? 'bg-red-500' :
                    'bg-yellow-500 animate-pulse'
                  }`} />
                  <span className="text-xs font-medium capitalize">{hostingStatus?.status || 'Unknown'}</span>
                  {hostingStatus?.uptime && <span className="text-[10px] text-muted-foreground">{hostingStatus.uptime}</span>}
                  {hostingStatus?.memory && <span className="text-[10px] text-muted-foreground">{hostingStatus.memory}</span>}
                </div>

                <div className="flex gap-1">
                  {linkedHosting.url && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" asChild>
                      <a href={linkedHosting.url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3 h-3 mr-1" /> Visit
                      </a>
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={handleDeploy} disabled={deploying}>
                    {deploying ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Play className="w-3 h-3 mr-1" />}
                    Deploy
                  </Button>
                  {linkedHosting.type !== 'static' && (
                    <>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleHostingControl('restart')} disabled={controlling}>
                        <RotateCcw className="w-3 h-3" />
                      </Button>
                      {hostingStatus?.status === 'online' ? (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-red-500" onClick={() => handleHostingControl('stop')} disabled={controlling}>
                          <Square className="w-3 h-3" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-green-500" onClick={() => handleHostingControl('start')} disabled={controlling}>
                          <Play className="w-3 h-3" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Logs toggle */}
              <div>
                <button onClick={fetchLogs} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Terminal className="w-3 h-3" />
                  {showLogs ? 'Refresh Logs' : 'View Logs'}
                </button>
                {showLogs && (
                  <div className="mt-2 bg-zinc-950 border rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800">
                      <span className="text-[10px] text-zinc-400 font-mono">Deploy Logs</span>
                      <button onClick={() => setShowLogs(false)} className="text-[10px] text-zinc-500 hover:text-zinc-300">Close</button>
                    </div>
                    <pre className="p-2 text-[10px] font-mono text-zinc-300 overflow-auto max-h-48 whitespace-pre-wrap">
                      {hostingLogs}
                      <span ref={logsEndRef} />
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Connect hosting to auto-deploy on push.
              </p>
              {hostingProjects.length > 0 && (
                <div className="flex gap-2">
                  <select
                    value={selectedHostingId}
                    onChange={e => setSelectedHostingId(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-sm bg-background border rounded-md"
                  >
                    <option value="">Select a hosting project...</option>
                    {hostingProjects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.type === 'static' ? 'Static' : p.type === 'node' ? 'Node.js' : 'Fullstack'})
                      </option>
                    ))}
                  </select>
                  <Button size="sm" onClick={handleLinkHosting} disabled={!selectedHostingId || hostingLinking} className="h-8">
                    <Link2 className="w-3.5 h-3.5 mr-1" /> {hostingLinking ? 'Linking...' : 'Connect'}
                  </Button>
                </div>
              )}
              {!showCreateHosting ? (
                <button onClick={() => setShowCreateHosting(true)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Create new hosting project
                </button>
              ) : (
                <div className="border rounded-lg p-3 space-y-2 bg-background">
                  <input
                    type="text"
                    value={newHosting.name}
                    onChange={e => setNewHosting(h => ({ ...h, name: e.target.value }))}
                    placeholder="Project name"
                    className="w-full px-3 py-1.5 text-sm bg-card border rounded-md"
                  />
                  <select
                    value={newHosting.type}
                    onChange={e => setNewHosting(h => ({ ...h, type: e.target.value }))}
                    className="w-full px-3 py-1.5 text-sm bg-card border rounded-md"
                  >
                    <option value="static">Static Site</option>
                    <option value="node">Node.js</option>
                    <option value="fullstack">Fullstack</option>
                  </select>
                  {newHosting.type !== 'static' && (
                    <input
                      type="text"
                      value={newHosting.buildCommand}
                      onChange={e => setNewHosting(h => ({ ...h, buildCommand: e.target.value }))}
                      placeholder="Build command (optional)"
                      className="w-full px-3 py-1.5 text-sm bg-card border rounded-md font-mono"
                    />
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateHosting} disabled={!newHosting.name || creatingHosting} className="h-7 text-xs">
                      {creatingHosting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                      {creatingHosting ? 'Creating...' : 'Create & Link'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowCreateHosting(false)} className="h-7 text-xs">
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
