import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { GitBranch, Database, Globe, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

export default function AddResourceDialog({ open, onOpenChange, pipelineId, environment, currentResources, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(null);
  const [selected, setSelected] = useState({ repo: new Set(), db: new Set(), hosting: new Set() });

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    setSelected({
      repo: new Set((currentResources?.repos || []).map(r => r.id)),
      db: new Set((currentResources?.databases || []).map(d => d.id)),
      hosting: new Set((currentResources?.hosting || []).map(h => h.id)),
    });

    api.get('/admin/pipeline/available-resources')
      .then(({ data }) => setAvailable(data))
      .catch(() => toast.error('Failed to load resources'))
      .finally(() => setLoading(false));
  }, [open, currentResources]);

  const toggle = (type, id) => {
    setSelected(prev => {
      const next = new Set(prev[type]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, [type]: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Get existing resources for the OTHER environment so we don't overwrite them
      const { data: fullPipeline } = await api.get(`/admin/pipeline/pipelines/${pipelineId}`);
      const otherEnv = environment === 'production' ? 'beta' : 'production';
      const otherResources = fullPipeline[otherEnv] || { repos: [], databases: [], hosting: [] };

      // Build full resource list: other env (unchanged) + this env (from checkboxes)
      const resources = [
        // Keep other environment's resources
        ...otherResources.repos.map((r, i) => ({ resource_type: 'repo', resource_id: r.id, environment: otherEnv, display_order: i })),
        ...otherResources.databases.map((d, i) => ({ resource_type: 'db', resource_id: d.id, environment: otherEnv, display_order: i })),
        ...otherResources.hosting.map((h, i) => ({ resource_type: 'hosting', resource_id: h.id, environment: otherEnv, display_order: i })),
        // Add this environment's selections
        ...[...selected.repo].map((id, i) => ({ resource_type: 'repo', resource_id: id, environment, display_order: i })),
        ...[...selected.db].map((id, i) => ({ resource_type: 'db', resource_id: id, environment, display_order: i })),
        ...[...selected.hosting].map((id, i) => ({ resource_type: 'hosting', resource_id: id, environment, display_order: i })),
      ];

      await api.put(`/admin/pipeline/pipelines/${pipelineId}/resources`, { resources });
      toast.success(`${environment} resources updated`);
      onOpenChange(false);
      if (onSaved) onSaved();
    } catch {
      toast.error('Failed to save resources');
    } finally {
      setSaving(false);
    }
  };

  const totalSelected = selected.repo.size + selected.db.size + selected.hosting.size;
  const envLabel = environment === 'production' ? 'Production' : 'Beta';
  const envColor = environment === 'production' ? 'text-emerald-400' : 'text-blue-400';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Add to <span className={envColor}>{envLabel}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <LoadingSpinner />
        ) : available ? (
          <Tabs defaultValue="repos" className="flex-1 flex flex-col min-h-0">
            <TabsList className="h-8 shrink-0">
              <TabsTrigger value="repos" className="text-xs px-3 h-7 gap-1.5">
                <GitBranch className="w-3 h-3" /> Repos
              </TabsTrigger>
              <TabsTrigger value="dbs" className="text-xs px-3 h-7 gap-1.5">
                <Database className="w-3 h-3" /> DBs
              </TabsTrigger>
              <TabsTrigger value="hosting" className="text-xs px-3 h-7 gap-1.5">
                <Globe className="w-3 h-3" /> Hosting
              </TabsTrigger>
            </TabsList>

            <TabsContent value="repos" className="flex-1 overflow-auto mt-2">
              <CheckboxList
                items={available.repos || []}
                selected={selected.repo}
                onToggle={(id) => toggle('repo', id)}
                renderItem={(item) => (
                  <>
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-2">/{item.slug}</span>
                    {item.visibility === 'private' && <Badge variant="outline" className="text-[9px] ml-auto">private</Badge>}
                  </>
                )}
              />
            </TabsContent>

            <TabsContent value="dbs" className="flex-1 overflow-auto mt-2">
              <CheckboxList
                items={available.databases || []}
                selected={selected.db}
                onToggle={(id) => toggle('db', id)}
                renderItem={(item) => (
                  <>
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-2">/{item.slug}</span>
                    {item.environment && item.environment !== 'production' && (
                      <Badge variant="outline" className="text-[9px] ml-auto">{item.environment}</Badge>
                    )}
                  </>
                )}
              />
            </TabsContent>

            <TabsContent value="hosting" className="flex-1 overflow-auto mt-2">
              <CheckboxList
                items={available.hosting || []}
                selected={selected.hosting}
                onToggle={(id) => toggle('hosting', id)}
                renderItem={(item) => (
                  <>
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="text-[11px] text-muted-foreground font-mono ml-2">/{item.slug}</span>
                    {item.project_type && <Badge variant="outline" className="text-[9px] ml-auto">{item.project_type}</Badge>}
                  </>
                )}
              />
            </TabsContent>
          </Tabs>
        ) : null}

        <DialogFooter className="border-t pt-3">
          <span className="text-xs text-muted-foreground mr-auto">
            {totalSelected} selected for {envLabel.toLowerCase()}
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckboxList({ items, selected, onToggle, renderItem }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-6">No resources available</p>;
  }

  return (
    <div className="space-y-0.5">
      {items.map((item) => {
        const isSelected = selected.has(item.id);
        return (
          <button
            key={item.id}
            onClick={() => onToggle(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
              isSelected
                ? 'bg-primary/10 border border-primary/30'
                : 'hover:bg-accent border border-transparent'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
              isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
            }`}>
              {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
            </div>
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {renderItem(item)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
