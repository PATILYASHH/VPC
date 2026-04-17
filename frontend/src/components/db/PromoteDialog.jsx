import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import SchemaDiffViewer from './SchemaDiffViewer';
import api from '@/lib/api';

export default function PromoteDialog({ open, onOpenChange, betaProject, prodProject, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [diff, setDiff] = useState(null);
  const [sql, setSql] = useState('');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [promoted, setPromoted] = useState(null);

  useEffect(() => {
    if (!open || !prodProject || !betaProject) return;
    setLoading(true);
    setError('');
    setDiff(null);
    setSql('');
    setPromoted(null);
    setTitle(`Promote from ${betaProject.name}`);

    api.get(`/admin/db/projects/${prodProject.id}/diff/${betaProject.id}`)
      .then(({ data }) => {
        setDiff(data.diff);
        setSql(data.sql);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Failed to compute diff');
      })
      .finally(() => setLoading(false));
  }, [open, prodProject?.id, betaProject?.id]);

  const handlePromote = async () => {
    setPromoting(true);
    try {
      const { data } = await api.post(`/admin/db/projects/${prodProject.id}/promote/${betaProject.id}`, {
        title,
      });
      if (data.message) {
        toast.info(data.message);
      } else {
        setPromoted(data.pr);
        toast.success(`Schema PR #${data.pr.pr_number} created on "${prodProject.name}"`);
      }
      if (onSuccess) onSuccess(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Promote failed');
    } finally {
      setPromoting(false);
    }
  };

  const hasChanges = diff && (diff.newTables.length > 0 || diff.modifiedTables.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" />
            Promote to Production
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Source/Target info */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex-1 p-2.5 rounded-lg border bg-blue-500/5 border-blue-500/15">
              <span className="text-muted-foreground">From: </span>
              <span className="font-medium">{betaProject?.name}</span>
              <span className="text-blue-400 ml-1 text-[10px]">({betaProject?.environment || 'beta'})</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 p-2.5 rounded-lg border bg-emerald-500/5 border-emerald-500/15">
              <span className="text-muted-foreground">To: </span>
              <span className="font-medium">{prodProject?.name}</span>
              <span className="text-emerald-400 ml-1 text-[10px]">({prodProject?.environment || 'production'})</span>
            </div>
          </div>

          {loading && <LoadingSpinner />}
          {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}

          {/* Diff viewer */}
          {diff && <SchemaDiffViewer diff={diff} sql={sql} />}

          {/* Promoted success */}
          {promoted && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-400">PR #{promoted.pr_number} created</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Go to {prodProject?.name}'s Sync tab to test and merge this PR.
                </p>
              </div>
            </div>
          )}

          {/* PR Title */}
          {hasChanges && !promoted && (
            <div className="space-y-1">
              <Label className="text-xs">PR Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {promoted ? 'Close' : 'Cancel'}
          </Button>
          {hasChanges && !promoted && (
            <Button onClick={handlePromote} disabled={promoting || !title}>
              {promoting ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creating PR...</>
              ) : (
                <><ArrowUpRight className="w-3.5 h-3.5 mr-1.5" /> Create Schema PR</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
