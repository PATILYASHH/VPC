import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Bell, Trash2, Smartphone } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

function generateSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

export default function ProjectList({ onSelectProject }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [androidPackageName, setAndroidPackageName] = useState('');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery('notify-projects', '/admin/notify/projects');

  const autoSlug = (val) => {
    setName(val);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(val));
    }
  };

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      const { data: result } = await api.post('/admin/notify/projects', {
        name,
        slug: slug || generateSlug(name),
        androidPackageName: androidPackageName || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['notify-projects'] });
      toast.success(`Project "${name}" created`);
      setShowCreate(false);
      setName('');
      setSlug('');
      setAndroidPackageName('');
      onSelectProject(result.project);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, project) => {
    e.stopPropagation();
    if (!confirm(`Delete project "${project.name}"? Devices, keys, and message history will be permanently removed.`)) return;
    try {
      await api.delete(`/admin/notify/projects/${project.id}`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['notify-projects'] });
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
            Notify Projects ({data?.projects?.length || 0})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Push notification projects for your Android apps</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Project
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {data?.projects?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bell className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No projects yet</p>
            <p className="text-xs mt-1">Create a project to start sending push notifications</p>
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
                    {project.android_package_name && (
                      <div className="text-[10px] text-muted-foreground/70 font-mono mt-0.5">{project.android_package_name}</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    title="Delete project"
                    onClick={(e) => handleDelete(e, project)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Smartphone className="w-3 h-3" /> Devices
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {project.device_count || 0} / {project.max_devices}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Notify Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Project Name</Label>
              <Input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="My Android App" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-app" className="text-sm font-mono" />
              <p className="text-[10px] text-muted-foreground">Used in API URLs: /api/notify/v1/... (auth is via API key, not the slug)</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Android Package Name (optional)</Label>
              <Input value={androidPackageName} onChange={(e) => setAndroidPackageName(e.target.value)} placeholder="com.example.myapp" className="text-sm font-mono" />
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
