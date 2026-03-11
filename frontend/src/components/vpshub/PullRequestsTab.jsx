import { useState } from 'react';
import { toast } from 'sonner';
import { GitPullRequest, GitMerge, Plus, Clock, User, Zap, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import PRStatusBadge from './PRStatusBadge';
import api from '@/lib/api';

export default function PullRequestsTab({ project, onSelectPR }) {
  const [filter, setFilter] = useState('open');
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSQL, setNewSQL] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Smart Merge state
  const [smartMerging, setSmartMerging] = useState(false);
  const [showSmartMerge, setShowSmartMerge] = useState(false);
  const [smartMergeResult, setSmartMergeResult] = useState(null);
  const [useAI, setUseAI] = useState(false);

  const { data, isLoading, refetch } = useApiQuery(
    ['sync-prs', project.id, filter],
    `/admin/sync/projects/${project.id}/pull-requests${filter !== 'all' ? `?status=${filter}` : ''}`
  );
  const prs = data?.pull_requests || [];

  const openCount = filter === 'open' ? prs.length : null;

  async function handleCreate() {
    if (!newTitle.trim() || !newSQL.trim()) {
      toast.error('Title and SQL are required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/admin/sync/projects/${project.id}/pull-requests`, {
        title: newTitle,
        description: newDesc,
        sql_content: newSQL,
      });
      toast.success('Pull request created');
      setShowNew(false);
      setNewTitle('');
      setNewSQL('');
      setNewDesc('');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create PR');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSmartMerge() {
    setSmartMerging(true);
    setSmartMergeResult(null);
    try {
      const { data: result } = await api.post(
        `/admin/sync/projects/${project.id}/smart-merge`,
        { useAI }
      );
      setSmartMergeResult(result);
      if (result.merged?.length > 0) {
        toast.success(result.message);
      } else {
        toast.error(result.message || 'No PRs could be merged');
      }
      refetch();
    } catch (err) {
      setSmartMergeResult({ success: false, message: err.response?.data?.error || 'Smart merge failed', merged: [], failed: [] });
      toast.error(err.response?.data?.error || 'Smart merge failed');
    } finally {
      setSmartMerging(false);
    }
  }

  function timeAgo(date) {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {['open', 'closed', 'all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                filter === f
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowSmartMerge(true)}
            disabled={smartMerging}
            className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10 hover:text-purple-300"
          >
            {smartMerging
              ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              : <Zap className="w-4 h-4 mr-1" />
            }
            Smart Merge
          </Button>
          <Button size="sm" onClick={() => setShowNew(!showNew)}>
            <Plus className="w-4 h-4 mr-1" />
            New Pull Request
          </Button>
        </div>
      </div>

      {/* New PR Form */}
      {showNew && (
        <div className="border rounded-lg bg-card p-4 space-y-3">
          <input
            className="w-full bg-background border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Pull request title..."
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
          />
          <textarea
            className="w-full bg-background border rounded-md px-3 py-2 text-sm h-20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Description (optional)..."
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
          />
          <textarea
            className="w-full bg-background border rounded-md px-3 py-2 text-xs font-mono h-40 resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="SQL content..."
            value={newSQL}
            onChange={e => setNewSQL(e.target.value)}
          />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Pull Request'}
            </Button>
          </div>
        </div>
      )}

      {/* PR List */}
      {isLoading ? (
        <LoadingSpinner />
      ) : prs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <GitPullRequest className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No {filter !== 'all' ? filter : ''} pull requests.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {prs.map(pr => (
            <button
              key={pr.id}
              onClick={() => onSelectPR(pr)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border rounded-lg bg-card hover:bg-accent/50 transition-colors group"
            >
              <GitPullRequest className={`w-5 h-5 shrink-0 ${
                pr.status === 'open' ? 'text-emerald-400' :
                pr.status === 'merged' ? 'text-purple-400' :
                pr.status === 'conflict' ? 'text-amber-400' :
                'text-muted-foreground'
              }`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium group-hover:text-primary transition-colors truncate">
                    {pr.title}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">#{pr.pr_number}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {pr.submitted_by}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {timeAgo(pr.created_at)}
                  </span>
                </div>
              </div>

              <PRStatusBadge status={pr.status} />

              {pr.sandbox_result && (
                <Badge variant="outline" className={`text-xs ${
                  pr.sandbox_result.success
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}>
                  {pr.sandbox_result.success ? 'Passed' : 'Failed'}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Smart Merge Dialog */}
      <Dialog open={showSmartMerge} onOpenChange={setShowSmartMerge}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-400" />
              Smart Merge
            </DialogTitle>
          </DialogHeader>

          {!smartMergeResult ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Smart Merge will automatically test and merge all open pull requests in sequence.
                Each PR is sandbox-tested before merging. If a PR fails, it will be skipped and the rest will continue.
              </p>

              <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                <input
                  type="checkbox"
                  id="useAI"
                  checked={useAI}
                  onChange={e => setUseAI(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="useAI" className="text-sm cursor-pointer">
                  <span className="font-medium">Use Claude AI</span>
                  <span className="text-muted-foreground block text-xs">
                    Analyze PRs and recommend optimal merge order based on dependencies
                  </span>
                </label>
              </div>

              <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>This will apply SQL changes to your database. Each PR is tested first, but make sure you have backups.</span>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSmartMerge(false)}>Cancel</Button>
                <Button
                  onClick={handleSmartMerge}
                  disabled={smartMerging}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {smartMerging
                    ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Merging...</>
                    : <><GitMerge className="w-4 h-4 mr-1.5" /> Start Smart Merge</>
                  }
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Results */}
              <div className={`flex items-center gap-2 p-3 rounded-lg border ${
                smartMergeResult.success
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-amber-500/5 border-amber-500/20'
              }`}>
                {smartMergeResult.success
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  : <AlertTriangle className="w-5 h-5 text-amber-400" />
                }
                <span className="text-sm font-medium">{smartMergeResult.message}</span>
              </div>

              {/* AI Analysis */}
              {smartMergeResult.ai_analysis?.notes && (
                <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-blue-400">Claude AI Analysis</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{smartMergeResult.ai_analysis.notes}</p>
                  {smartMergeResult.ai_analysis.dependency_notes?.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {smartMergeResult.ai_analysis.dependency_notes.map((note, i) => (
                        <li key={i} className="text-xs text-muted-foreground">- {note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Merged PRs */}
              {smartMergeResult.merged?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-emerald-400">Merged ({smartMergeResult.merged.length})</span>
                  {smartMergeResult.merged.map(pr => (
                    <div key={pr.pr_number} className="flex items-center gap-2 text-xs p-2 bg-emerald-500/5 rounded">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-medium">#{pr.pr_number}</span>
                      <span className="text-muted-foreground truncate">{pr.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Failed PRs */}
              {smartMergeResult.failed?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-red-400">Failed ({smartMergeResult.failed.length})</span>
                  {smartMergeResult.failed.map(pr => (
                    <div key={pr.pr_number} className="text-xs p-2 bg-red-500/5 rounded space-y-0.5">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                        <span className="font-medium">#{pr.pr_number}</span>
                        <span className="text-muted-foreground truncate">{pr.title}</span>
                      </div>
                      <p className="text-red-400/70 pl-5 font-mono text-[10px]">{pr.error}</p>
                    </div>
                  ))}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowSmartMerge(false); setSmartMergeResult(null); }}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
