import { useState } from 'react';
import { X, GitBranch, Lock, Globe } from 'lucide-react';
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
      const { data } = await api.post('/admin/vpshub/repos', {
        name: name.trim(),
        description: description.trim(),
        visibility,
        initReadme,
      });
      toast.success(`Repository "${name}" created`);
      onCreated(data.repo);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create repository');
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
            <h3 className="font-semibold">Create New Repository</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-4 space-y-4">
          <div>
            <Label>Repository Name</Label>
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
              placeholder="A short description of your repository"
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

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || loading}>
              {loading ? 'Creating...' : 'Create Repository'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
