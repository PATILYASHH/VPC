import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, LayoutDashboard, Trash2, GitBranch, Database, Globe } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

const COLORS = [
  { value: 'blue', class: 'bg-blue-500' },
  { value: 'emerald', class: 'bg-emerald-500' },
  { value: 'violet', class: 'bg-violet-500' },
  { value: 'rose', class: 'bg-rose-500' },
  { value: 'amber', class: 'bg-amber-500' },
  { value: 'cyan', class: 'bg-cyan-500' },
];

export default function PipelineList({ onSelectPipeline }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('blue');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery('pipelines', '/admin/pipeline/pipelines');

  const generateSlug = (str) =>
    str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100);

  const autoSlug = (val) => {
    setName(val);
    setSlug(generateSlug(val));
  };

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      const { data: result } = await api.post('/admin/pipeline/pipelines', {
        name, slug: slug || generateSlug(name), description, color,
      });
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success(`Pipeline "${name}" created`);
      setShowCreate(false);
      resetForm();
      onSelectPipeline(result.pipeline);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create pipeline');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, pipeline) => {
    e.stopPropagation();
    if (!confirm(`Delete pipeline "${pipeline.name}"? This only removes the grouping, not the linked resources.`)) return;
    try {
      await api.delete(`/admin/pipeline/pipelines/${pipeline.id}`);
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      toast.success(`Pipeline "${pipeline.name}" deleted`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete');
    }
  };

  const resetForm = () => {
    setName(''); setSlug(''); setDescription(''); setColor('blue');
  };

  if (isLoading) return <LoadingSpinner />;

  const pipelines = data?.pipelines || [];

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Pipelines ({pipelines.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Group your repos, databases & hosting sites</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Pipeline
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {pipelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <LayoutDashboard className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No pipelines yet</p>
            <p className="text-xs mt-1">Create a pipeline to group related resources</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pipelines.map((pipeline) => {
              const prodCounts = pipeline.resource_counts?.production || {};
              const betaCounts = pipeline.resource_counts?.beta || {};
              const prodTotal = (prodCounts.repo || 0) + (prodCounts.db || 0) + (prodCounts.hosting || 0);
              const betaTotal = (betaCounts.repo || 0) + (betaCounts.db || 0) + (betaCounts.hosting || 0);
              const total = prodTotal + betaTotal;
              const accentColor = COLORS.find(c => c.value === pipeline.color)?.class || 'bg-blue-500';

              return (
                <div
                  key={pipeline.id}
                  onClick={() => onSelectPipeline(pipeline)}
                  className="border rounded-lg overflow-hidden bg-card hover:border-primary/50 cursor-pointer transition-colors group"
                >
                  {/* Color accent bar */}
                  <div className={`h-1 ${accentColor}`} />

                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-medium text-sm group-hover:text-primary transition-colors">
                          {pipeline.name}
                        </h3>
                        {pipeline.description && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{pipeline.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost" size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          onClick={(e) => handleDelete(e, pipeline)}
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {/* Environment counts */}
                    <div className="flex items-center gap-4 mt-3 text-xs">
                      {prodTotal > 0 && (
                        <span className="flex items-center gap-1.5 text-emerald-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          {prodTotal} prod
                        </span>
                      )}
                      {betaTotal > 0 && (
                        <span className="flex items-center gap-1.5 text-blue-400">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          {betaTotal} beta
                        </span>
                      )}
                      {total === 0 && <span className="text-muted-foreground/50">No resources linked</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) resetForm(); setShowCreate(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="KopERP" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug</Label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="koperp" className="text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ERP system for Kolhapur..." className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setColor(c.value)}
                    className={`w-7 h-7 rounded-full ${c.class} transition-all ${
                      color === c.value ? 'ring-2 ring-offset-2 ring-offset-background ring-primary scale-110' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name || creating}>
              {creating ? 'Creating...' : 'Create Pipeline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
