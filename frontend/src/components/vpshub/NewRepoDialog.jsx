import { useState } from 'react';
import { X, GitBranch, Lock, Globe, Database, RefreshCw, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function NewRepoDialog({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [initReadme, setInitReadme] = useState(true);
  const [loading, setLoading] = useState(false);
  // Unified project options
  const [fullProject, setFullProject] = useState(false);
  const [includeDatabase, setIncludeDatabase] = useState(true);
  const [enableSync, setEnableSync] = useState(true);

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      if (fullProject) {
        // Create unified project (repo + database + sync)
        const { data } = await api.post('/admin/vpshub/unified-project', {
          name: name.trim(),
          description: description.trim(),
          visibility,
          includeDatabase,
          enableSync,
        });
        const parts = ['Repository'];
        if (data.database) parts.push('Database');
        if (data.syncEnabled) parts.push('Sync');
        toast.success(`${parts.join(' + ')} created!`);
        onCreated(data.repo);
      } else {
        // Just create repo
        const { data } = await api.post('/admin/vpshub/repos', {
          name: name.trim(),
          description: description.trim(),
          visibility,
          initReadme,
        });
        toast.success(`Repository "${name}" created`);
        onCreated(data.repo);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border rounded-lg w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Create New Project</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-4 space-y-4">
          <div>
            <Label>Project Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="my-project"
              autoFocus
            />
            {slug && slug !== name && (
              <p className="text-xs text-muted-foreground mt-1">
                Will be created as: <span className="font-mono">{slug}</span>
              </p>
            )}
          </div>

          <div>
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What is this project about?"
            />
          </div>

          <div>
            <Label>Visibility</Label>
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={() => setVisibility('private')}
                className={`flex-1 flex items-center gap-2 p-3 rounded border text-sm transition-colors ${
                  visibility === 'private'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                <Lock className="w-4 h-4" />
                <div className="text-left">
                  <div className="font-medium">Private</div>
                  <div className="text-xs opacity-70">Only you and collaborators</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setVisibility('public')}
                className={`flex-1 flex items-center gap-2 p-3 rounded border text-sm transition-colors ${
                  visibility === 'public'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                <Globe className="w-4 h-4" />
                <div className="text-left">
                  <div className="font-medium">Public</div>
                  <div className="text-xs opacity-70">Anyone can clone</div>
                </div>
              </button>
            </div>
          </div>

          {/* Project Type Toggle */}
          <div className="border border-white/[0.08] rounded-lg overflow-hidden">
            <div className="flex">
              <button
                type="button"
                onClick={() => setFullProject(false)}
                className={`flex-1 flex items-center justify-center gap-2 p-2.5 text-xs font-medium transition-colors ${
                  !fullProject ? 'bg-white/[0.08] text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                Code Only
              </button>
              <button
                type="button"
                onClick={() => setFullProject(true)}
                className={`flex-1 flex items-center justify-center gap-2 p-2.5 text-xs font-medium transition-colors ${
                  fullProject ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Full Project
              </button>
            </div>

            {fullProject && (
              <div className="border-t border-white/[0.06] p-3 space-y-2.5 bg-white/[0.01]">
                <p className="text-[10px] text-muted-foreground/60">
                  Creates a repo + database + sync tracking in one click
                </p>

                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={includeDatabase}
                    onChange={e => setIncludeDatabase(e.target.checked)}
                    className="rounded border-border"
                  />
                  <Database className="w-3.5 h-3.5 text-emerald-400" />
                  <div>
                    <span className="text-xs font-medium">Include Database</span>
                    <p className="text-[10px] text-muted-foreground/50">Creates a DB project linked to this repo</p>
                  </div>
                </label>

                <label className={`flex items-center gap-2.5 cursor-pointer group ${!includeDatabase ? 'opacity-40 pointer-events-none' : ''}`}>
                  <input
                    type="checkbox"
                    checked={enableSync && includeDatabase}
                    onChange={e => setEnableSync(e.target.checked)}
                    disabled={!includeDatabase}
                    className="rounded border-border"
                  />
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <div>
                    <span className="text-xs font-medium">Enable Schema Sync</span>
                    <p className="text-[10px] text-muted-foreground/50">Track database changes as migrations</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {!fullProject && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="init-readme"
                checked={initReadme}
                onChange={e => setInitReadme(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="init-readme" className="text-sm text-muted-foreground cursor-pointer">
                Initialize with a README file
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? 'Creating...' : fullProject ? 'Create Full Project' : 'Create Repository'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
