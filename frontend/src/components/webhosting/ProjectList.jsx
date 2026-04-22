import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Globe, Trash2, GitBranch, Play, Square, AlertCircle, Loader2, Search, Github, Lock, X, ExternalLink } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import useWindowStore from '@/stores/useWindowStore';

const PROJECT_TYPES = [
  { value: 'static', label: 'Static Site', desc: 'HTML, CSS, JS — served as static files' },
  { value: 'node', label: 'Node.js Backend', desc: 'Express, Fastify, etc. — managed with PM2' },
  { value: 'fullstack', label: 'Fullstack', desc: 'Static frontend + Node.js API backend' },
];

export default function ProjectList({ onSelectProject }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', slug: '', projectType: 'static', gitUrl: '', gitBranch: 'main',
    buildCommand: '', installCommand: 'npm install', outputDir: '', nodeEntryPoint: 'index.js',
  });
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery('wh-projects', '/admin/web-hosting/projects');

  const generateSlug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

  const setField = (key, val) => {
    setForm(prev => {
      const next = { ...prev, [key]: val };
      if (key === 'name' && (!prev.slug || prev.slug === generateSlug(prev.name))) {
        next.slug = generateSlug(val);
      }
      // Bug #12: Smarter defaults based on project type
      if (key === 'projectType') {
        if (val === 'fullstack') {
          if (!prev.installCommand || prev.installCommand === 'npm install') {
            next.installCommand = '';
          }
        } else if (val === 'static') {
          next.nodeEntryPoint = '';
        } else {
          if (!prev.installCommand) {
            next.installCommand = 'npm install';
          }
        }
      }
      return next;
    });
  };

  const resetForm = () => setForm({
    name: '', slug: '', projectType: 'static', gitUrl: '', gitBranch: 'main',
    buildCommand: '', installCommand: 'npm install', outputDir: '', nodeEntryPoint: 'index.js',
  });

  const pickRepo = (repo) => {
    // repo is a GitHub API response — fill Name, Slug, Git URL, Branch
    setForm(prev => ({
      ...prev,
      name: prev.name || repo.name,
      slug: prev.slug || generateSlug(repo.name),
      gitUrl: repo.clone_url || `${repo.html_url}.git`,
      gitBranch: repo.default_branch || 'main',
    }));
    setShowRepoPicker(false);
  };

  const handleCreate = async () => {
    if (!form.name || !form.gitUrl) return;
    setCreating(true);
    try {
      const { data: project } = await api.post('/admin/web-hosting/projects', form);
      queryClient.invalidateQueries({ queryKey: ['wh-projects'] });
      toast.success(`Project "${form.name}" created`);
      setShowCreate(false);
      resetForm();

      // Bug #11: After creation, trigger scan and navigate to dashboard
      try {
        const { data: scanResult } = await api.post(`/admin/web-hosting/projects/${project.id}/scan`);
        if (scanResult?.detected) {
          const d = scanResult.detected;
          const autoUpdates = {};
          if (d.installCommand) autoUpdates.installCommand = d.installCommand;
          if (d.buildCommand) autoUpdates.buildCommand = d.buildCommand;
          if (d.outputDir) autoUpdates.outputDir = d.outputDir;
          if (d.nodeEntryPoint) autoUpdates.nodeEntryPoint = d.nodeEntryPoint;
          if (d.projectType && d.projectType !== 'static') autoUpdates.projectType = d.projectType;

          if (Object.keys(autoUpdates).length > 0) {
            await api.put(`/admin/web-hosting/projects/${project.id}`, autoUpdates);
            const parts = [];
            if (d.framework) parts.push(d.framework.charAt(0).toUpperCase() + d.framework.slice(1));
            if (d.frontendDir) parts.push(`frontend in /${d.frontendDir}`);
            if (d.backendDir) parts.push(`backend in /${d.backendDir}`);
            toast.success(`Auto-detected: ${parts.join(', ') || d.projectType}. Settings have been configured.`, { duration: 6000 });
          }
          // Refetch so dashboard shows updated values
          queryClient.invalidateQueries({ queryKey: ['wh-projects'] });
        }
      } catch {
        // Scan failed — that's fine, user can configure manually
      }

      onSelectProject(project);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, project) => {
    e.stopPropagation();
    if (!confirm(`Delete "${project.name}"? This will stop the process and remove all files.`)) return;
    try {
      await api.delete(`/admin/web-hosting/projects/${project.id}`);
      queryClient.invalidateQueries({ queryKey: ['wh-projects'] });
      toast.success(`Project "${project.name}" deleted`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  const projects = data?.projects || [];

  const statusColor = (s) => {
    if (s === 'running') return 'bg-emerald-500';
    if (s === 'deploying') return 'bg-amber-500 animate-pulse';
    if (s === 'error') return 'bg-red-500';
    return 'bg-zinc-400';
  };

  const statusBadge = (s) => {
    if (s === 'running') return 'success';
    if (s === 'error') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Web Hosting ({projects.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Host websites and Node.js backends</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New Project
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Globe className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No hosted projects yet</p>
            <p className="text-xs mt-1">Deploy your first website or API</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(project => (
              <div
                key={project.id}
                onClick={() => onSelectProject(project)}
                className="border rounded-lg p-4 bg-card hover:border-primary/50 cursor-pointer transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${statusColor(project.status)}`} />
                    <div>
                      <h3 className="font-medium text-sm group-hover:text-primary transition-colors">{project.name}</h3>
                      <span className="text-xs text-muted-foreground font-mono">/{project.slug}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={statusBadge(project.status)} className="text-[10px]">{project.status}</Badge>
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => handleDelete(e, project)}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Type</span>
                    <Badge variant="outline" className="text-[10px]">{project.project_type}</Badge>
                  </div>
                  {project.git_url && (
                    <div className="flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      <span className="truncate font-mono text-[10px]">{project.git_branch || 'main'}</span>
                    </div>
                  )}
                  {project.last_deploy_at && (
                    <div className="flex items-center justify-between">
                      <span>Last Deploy</span>
                      <span className="font-mono text-[10px]">{new Date(project.last_deploy_at).toLocaleDateString()}</span>
                    </div>
                  )}
                  {project.node_port && (
                    <div className="flex items-center justify-between">
                      <span>Port</span>
                      <span className="font-mono">{project.node_port}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GitHub repo picker */}
      {showRepoPicker && (
        <GitHubRepoPicker
          onPick={pickRepo}
          onClose={() => setShowRepoPicker(false)}
        />
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Hosting Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Project Name</Label>
              <Input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="My Website" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug</Label>
              <Input value={form.slug} onChange={e => setField('slug', e.target.value)} placeholder="my-website" className="text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground">URL: {window.location.origin}/{form.slug || 'my-website'}</p>
            </div>

            {/* Project Type */}
            <div className="space-y-1">
              <Label className="text-xs">Project Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PROJECT_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setField('projectType', t.value)}
                    className={`border rounded-lg p-2 text-left transition-colors ${form.projectType === t.value ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/30'}`}
                  >
                    <span className="text-xs font-medium block">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Git — pick from GitHub or paste URL */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Git Repository</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRepoPicker(true)}
                  className="h-6 px-2 text-[10px] gap-1"
                >
                  <Github className="w-3 h-3" /> Import from GitHub
                </Button>
              </div>
              <Input
                value={form.gitUrl}
                onChange={e => setField('gitUrl', e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Private repos use your saved GitHub connection automatically — no token needed here.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <Input value={form.gitBranch} onChange={e => setField('gitBranch', e.target.value)} className="text-sm font-mono" />
            </div>

            {/* Build — Bug #12: show placeholder for fullstack, hide entry point for static */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Install Command</Label>
                <Input
                  value={form.installCommand}
                  onChange={e => setField('installCommand', e.target.value)}
                  placeholder={form.projectType === 'fullstack' ? 'Auto-detected on deploy' : 'npm install'}
                  className="text-sm font-mono"
                />
                {form.projectType === 'fullstack' && !form.installCommand && (
                  <p className="text-[10px] text-muted-foreground">Leave blank to auto-detect on first deploy</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Build Command <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  value={form.buildCommand}
                  onChange={e => setField('buildCommand', e.target.value)}
                  placeholder={form.projectType === 'fullstack' ? 'Auto-detected on deploy' : 'npm run build'}
                  className="text-sm font-mono"
                />
              </div>
            </div>

            {(form.projectType === 'static' || form.projectType === 'fullstack') && (
              <div className="space-y-1">
                <Label className="text-xs">Output Directory <span className="text-muted-foreground">(for built files)</span></Label>
                <Input value={form.outputDir} onChange={e => setField('outputDir', e.target.value)} placeholder="dist or build" className="text-sm font-mono" />
              </div>
            )}

            {/* Bug #12: Hide entry point for static projects */}
            {(form.projectType === 'node' || form.projectType === 'fullstack') && (
              <div className="space-y-1">
                <Label className="text-xs">Node Entry Point</Label>
                <Input value={form.nodeEntryPoint} onChange={e => setField('nodeEntryPoint', e.target.value)} placeholder="index.js" className="text-sm font-mono" />
              </div>
            )}

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border/50">
              <Search className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[10px] text-muted-foreground">
                After creation, the repo will be scanned to auto-detect framework, install/build commands, output directory, and entry point. You can override any setting later.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.name || !form.gitUrl || creating}>
              {creating ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creating...</> : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── GitHub repo picker ─────────────────────────────────────
// Lists the authenticated user's repos via the saved GitHub integration.
// If no GitHub connection exists, prompts the user to open Connections.

function GitHubRepoPicker({ onPick, onClose }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [needsConnection, setNeedsConnection] = useState(false);
  const [err, setErr] = useState(null);
  const openWindow = useWindowStore((s) => s.openWindow);

  useEffect(() => {
    let alive = true;
    api.get('/admin/integrations/proxy/github/repos?app=web-hosting')
      .then(({ data }) => {
        if (!alive) return;
        setRepos(data.repos || []);
      })
      .catch((e) => {
        if (!alive) return;
        const code = e.response?.data?.code || e.response?.status;
        if (code === 'INTEGRATION_MISSING' || e.response?.status === 412 || e.response?.status === 404) {
          setNeedsConnection(true);
        } else {
          setErr(e.response?.data?.error || e.message);
        }
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = repos.filter(r =>
    !search || r.full_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-2xl mx-4 max-h-[80vh] flex flex-col"
        style={{ borderColor: 'var(--surface-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Github className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Import from GitHub</h3>
              <p className="text-[10px] text-muted-foreground">Pick a repo — no token paste.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 overflow-auto flex-1">
          {loading ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
              Loading repositories…
            </div>
          ) : needsConnection ? (
            <div className="border border-dashed rounded-xl p-4 text-center" style={{ borderColor: 'var(--surface-border)' }}>
              <Lock className="w-6 h-6 mx-auto mb-2 text-amber-400" />
              <p className="text-xs font-medium">GitHub is not connected yet</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 mb-3">
                Connect GitHub once in the Connections app, then come back here.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { openWindow?.({ appId: 'connections' }); onClose(); }}
                className="text-xs"
              >
                <ExternalLink className="w-3 h-3 mr-1.5" /> Open Connections
              </Button>
            </div>
          ) : err ? (
            <div className="text-center py-6 text-xs text-rose-400">
              <AlertCircle className="w-5 h-5 mx-auto mb-1" />
              {err}
            </div>
          ) : repos.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No repositories found.</div>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50" />
                <Input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search repos…"
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                {filtered.slice(0, 60).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onPick(r)}
                    className="w-full text-left px-3 py-2 rounded-lg border hover:bg-white/[0.03] transition-colors"
                    style={{ borderColor: 'var(--surface-border)' }}
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs font-semibold truncate">{r.full_name}</span>
                      {r.private && <Lock className="w-2.5 h-2.5 text-amber-400" />}
                      {r.fork && <Badge variant="outline" className="text-[8px]">fork</Badge>}
                    </div>
                    {r.description && (
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{r.description}</div>
                    )}
                    <div className="text-[9px] text-muted-foreground/60 mt-0.5">
                      {r.default_branch || 'main'} · {r.language || 'unknown'} · updated {r.pushed_at?.slice(0, 10)}
                    </div>
                  </button>
                ))}
                {filtered.length > 60 && (
                  <div className="text-center text-[10px] text-muted-foreground py-2">
                    Showing 60 of {filtered.length} — refine search to see more.
                  </div>
                )}
                {filtered.length === 0 && (
                  <div className="text-center text-[10px] text-muted-foreground py-4">No matches.</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
