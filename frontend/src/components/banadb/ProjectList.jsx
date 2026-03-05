import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Database, Trash2, HardDrive } from 'lucide-react';
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

  const storage = data?.storage || {};
  const totalAllocated = storage.total_allocated_mb || 0;
  const totalUsed = storage.total_used_mb || 0;

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

      {/* Storage Overview Banner */}
      {data?.projects?.length > 0 && (
        <div className="mx-4 mt-4 border rounded-lg p-3 bg-muted/30">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Storage Overview</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="block text-muted-foreground">Total Allocated</span>
              <span className="font-semibold text-sm">{formatMb(totalAllocated)}</span>
            </div>
            <div>
              <span className="block text-muted-foreground">Total Used</span>
              <span className="font-semibold text-sm">{formatMb(totalUsed)}</span>
            </div>
            <div>
              <span className="block text-muted-foreground">Remaining</span>
              <span className="font-semibold text-sm">{formatMb(totalAllocated - totalUsed)}</span>
            </div>
          </div>
          <div className="mt-2">
            <Progress value={totalAllocated > 0 ? (totalUsed / totalAllocated) * 100 : 0} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-1">
              {totalAllocated > 0 ? Math.round((totalUsed / totalAllocated) * 100) : 0}% of allocated storage in use across {storage.project_count || 0} projects
            </p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {data?.projects?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Database className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No projects yet</p>
            <p className="text-xs mt-1">Create your first database project</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data?.projects?.map((project) => {
              const usedMb = project.storage_used_mb || 0;
              const limitMb = project.storage_limit_mb || 500;
              const usedPercent = (usedMb / limitMb) * 100;
              const isNearLimit = usedPercent > 80;
              const isOverLimit = usedPercent >= 100;

              return (
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
                    {/* Storage: used / allocated */}
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className={`${isOverLimit ? 'text-destructive font-medium' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'}`}>
                          Storage
                        </span>
                        <span className={`font-mono ${isOverLimit ? 'text-destructive' : isNearLimit ? 'text-amber-500' : ''}`}>
                          {formatMb(usedMb)} / {formatMb(limitMb)}
                        </span>
                      </div>
                      <Progress
                        value={Math.min(usedPercent, 100)}
                        className={`h-1.5 ${isOverLimit ? '[&>div]:bg-destructive' : isNearLimit ? '[&>div]:bg-amber-500' : ''}`}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Max Connections</span>
                      <span className="font-mono">{project.max_connections}</span>
                    </div>

                    {/* Allocated badge */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Allocated</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{formatMb(limitMb)}</Badge>
                    </div>
                  </div>
                </div>
              );
            })}
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

            {/* Storage allocation info */}
            <div className="border rounded p-2.5 bg-muted/30 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Already Allocated</span>
                <span className="font-mono">{formatMb(totalAllocated)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Currently Used</span>
                <span className="font-mono">{formatMb(totalUsed)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium">
                <span>After This Project</span>
                <span className="font-mono">{formatMb(totalAllocated + storageLimitMb)} allocated</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Each project gets its own isolated database. Storage limits are enforced — writes are blocked when a project exceeds its allocation.
              </p>
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

function formatMb(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}
