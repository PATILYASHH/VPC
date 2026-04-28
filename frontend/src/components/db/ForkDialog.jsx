import { useState } from 'react';
import { toast } from 'sonner';
import { GitFork, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import api from '@/lib/api';

const ENVIRONMENTS = [
  { value: 'beta', label: 'Beta', color: 'text-blue-400' },
  { value: 'development', label: 'Development', color: 'text-amber-400' },
  { value: 'staging', label: 'Staging', color: 'text-purple-400' },
  { value: 'production', label: 'Production', color: 'text-emerald-400' },
];

export default function ForkDialog({ open, onOpenChange, sourceProject, onSuccess }) {
  const [name, setName] = useState(`${sourceProject?.name || ''} (Beta)`);
  const [slug, setSlug] = useState(`${sourceProject?.slug || ''}-beta`);
  const [environment, setEnvironment] = useState('beta');
  const [copyData, setCopyData] = useState(true);
  const [forking, setForking] = useState(false);

  const generateSlug = (str) =>
    str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

  const autoSlug = (val) => {
    setName(val);
    setSlug(generateSlug(val));
  };

  const handleFork = async () => {
    if (!name) return;
    setForking(true);
    try {
      const { data } = await api.post(`/admin/db/projects/${sourceProject.id}/fork`, {
        name,
        slug: slug || generateSlug(name),
        copyData,
        environment,
      });
      toast.success(`Forked "${sourceProject.name}" into "${name}"`);
      onOpenChange(false);
      if (onSuccess) onSuccess(data.project);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Fork failed');
    } finally {
      setForking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="w-4 h-4" />
            Fork Project
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="p-3 rounded-lg border bg-muted/30 text-xs">
            <span className="text-muted-foreground">Source: </span>
            <span className="font-medium">{sourceProject?.name}</span>
            <span className="text-muted-foreground ml-2 font-mono">/{sourceProject?.slug}</span>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Fork Name</Label>
            <Input value={name} onChange={(e) => autoSlug(e.target.value)} placeholder="My App (Beta)" className="text-sm" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Slug</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-app-beta" className="text-sm font-mono" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Environment</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {ENVIRONMENTS.map((env) => (
                <button
                  key={env.value}
                  onClick={() => setEnvironment(env.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    environment === env.value
                      ? 'bg-primary/10 border-primary/50 text-primary'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {env.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border hover:bg-accent/50 transition-colors">
            <input
              type="checkbox"
              checked={copyData}
              onChange={(e) => setCopyData(e.target.checked)}
              className="rounded"
            />
            <div>
              <span className="text-xs font-medium">Full clone (schema + data)</span>
              <p className="text-[10px] text-muted-foreground">Default. Uncheck to fork schema only (no rows).</p>
            </div>
          </label>

          {copyData ? (
            <div className="text-[10px] text-emerald-500 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
              Will clone all tables, indexes, constraints, and row data. May take longer for large databases.
            </div>
          ) : (
            <div className="text-[10px] text-amber-500 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
              Schema-only fork — tables and structure will be cloned but no row data.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleFork} disabled={!name || forking}>
            {forking ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Forking...</>
            ) : (
              <><GitFork className="w-3.5 h-3.5 mr-1.5" /> Fork Project</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
