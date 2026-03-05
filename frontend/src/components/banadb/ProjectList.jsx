import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Database, Trash2 } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

export default function ProjectList({ onSelectProject }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [storageLimitMb, setStorageLimitMb] = useState(500);
  const [maxConnections, setMaxConnections] = useState(10);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery('bana-projects', '/admin/bana/projects');

  const autoSlug = (val) => {
    setName(val);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(val));
    }
  };

  function generateSlug(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  }

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      const { data: result } = await api.post('/admin/bana/projects', {
        name,
        slug: slug || generateSlug(name),
        storageLimitMb,
        maxConnections,
      });
      queryClient.invalidateQueries({ queryKey: ['bana-projects'] });
      toast.success(`Project "${name}" created`);
      setShowCreate(false);
      setName('');
      setSlug('');
      setStorageLimitMb(500);
      setMaxConnections(10);
      onSelectProject(result.project);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, project) => {
    e.stopPropagation();
    if (!confirm(`Delete project "${project.name}"? This will permanently drop the database.`)) return;
    try {
      await api.delete(`/admin/bana/projects/${project.id}`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['bana-projects'] });
      toast.success(`Project "${project.name}" deleted`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete project');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            BanaDB Projects ({data?.projects?.length || 0})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage your database projects</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Project
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {data?.projects?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Database className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No projects yet</p>
            <p className="text-xs mt-1">Create your first database project</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.projects?.map((project) => (
              <div
                key={project.id}
                onClick={() => onSelectProject(project)}
                className="border rounded-lg p-4 bg-card hover:border-primary/50 cursor-pointer transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <span className="text-xs text-muted-foreground font-mono">/{project.slug}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={project.status === 'active' ? 'success' : 'destructive'} className="text-[10px]">
                      {project.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e) => handleDelete(e, project)}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Storage</span>
                      <span>{project.storage_used_mb || 0} / {project.storage_limit_mb} MB</span>
                    </div>
                    <Progress value={((project.storage_used_mb || 0) / project.storage_limit_mb) * 100} className="h-1.5" />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Max Connections</span>
                    <span className="font-mono">{project.max_connections}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Project Name</Label>
              <Input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="My App" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-app" className="text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground">Used in API URLs: /api/bana/v1/{slug || 'my-app'}/...</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Storage Limit (MB)</Label>
                <Input type="number" value={storageLimitMb} onChange={(e) => setStorageLimitMb(parseInt(e.target.value) || 500)} className="text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Connections</Label>
                <Input type="number" value={maxConnections} onChange={(e) => setMaxConnections(parseInt(e.target.value) || 10)} className="text-sm" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name || creating}>
              {creating ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
