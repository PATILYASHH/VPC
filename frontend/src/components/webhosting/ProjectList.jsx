import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Globe, Trash2, GitBranch, Play, Square, AlertCircle, Loader2 } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

const PROJECT_TYPES = [
  { value: 'static', label: 'Static Site', desc: 'HTML, CSS, JS — served as static files' },
  { value: 'node', label: 'Node.js Backend', desc: 'Express, Fastify, etc. — managed with PM2' },
  { value: 'fullstack', label: 'Fullstack', desc: 'Static frontend + Node.js API backend' },
];

export default function ProjectList({ onSelectProject }) {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', slug: '', projectType: 'static', gitUrl: '', gitToken: '', gitBranch: 'main',
    buildCommand: '', installCommand: 'npm install', outputDir: '', nodeEntryPoint: 'index.js',
  });
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery('wh-projects', '/admin/web-hosting/projects');

  const generateSlug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

  const setField = (key, val) => {
    setForm(prev => {
      const next = { ...prev, [key]: val };
      if (key === 'name' && (!prev.slug || prev.slug === generateSlug(prev.name))) {
        next.slug = generateSlug(val);
      }
      return next;
    });
  };

  const resetForm = () => setForm({
    name: '', slug: '', projectType: 'static', gitUrl: '', gitToken: '', gitBranch: 'main',
    buildCommand: '', installCommand: 'npm install', outputDir: '', nodeEntryPoint: 'index.js',
  });

  const handleCreate = async () => {
    if (!form.name || !form.gitUrl) return;
    setCreating(true);
    try {
      const { data: project } = await api.post('/admin/web-hosting/projects', form);
      queryClient.invalidateQueries({ queryKey: ['wh-projects'] });
      toast.success(`Project "${form.name}" created`);
      setShowCreate(false);
      resetForm();
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
              <div className="grid grid-cols-3 gap-2">
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

            {/* Git */}
            <div className="space-y-1">
              <Label className="text-xs">Git Repository URL</Label>
              <Input value={form.gitUrl} onChange={e => setField('gitUrl', e.target.value)} placeholder="https://github.com/user/repo.git" className="text-sm font-mono" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Access Token <span className="text-muted-foreground">(for private repos)</span></Label>
                <Input type="password" value={form.gitToken} onChange={e => setField('gitToken', e.target.value)} placeholder="ghp_xxxx" className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Branch</Label>
                <Input value={form.gitBranch} onChange={e => setField('gitBranch', e.target.value)} className="text-sm font-mono" />
              </div>
            </div>

            {/* Build */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Install Command</Label>
                <Input value={form.installCommand} onChange={e => setField('installCommand', e.target.value)} className="text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Build Command <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={form.buildCommand} onChange={e => setField('buildCommand', e.target.value)} placeholder="npm run build" className="text-sm font-mono" />
              </div>
            </div>

            {(form.projectType === 'static' || form.projectType === 'fullstack') && (
              <div className="space-y-1">
                <Label className="text-xs">Output Directory <span className="text-muted-foreground">(for built files)</span></Label>
                <Input value={form.outputDir} onChange={e => setField('outputDir', e.target.value)} placeholder="dist or build" className="text-sm font-mono" />
              </div>
            )}

            {(form.projectType === 'node' || form.projectType === 'fullstack') && (
              <div className="space-y-1">
                <Label className="text-xs">Node Entry Point</Label>
                <Input value={form.nodeEntryPoint} onChange={e => setField('nodeEntryPoint', e.target.value)} placeholder="index.js" className="text-sm font-mono" />
              </div>
            )}
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
