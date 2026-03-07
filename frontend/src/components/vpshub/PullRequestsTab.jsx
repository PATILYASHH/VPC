import { useState } from 'react';
import { toast } from 'sonner';
import { GitPullRequest, Plus, Clock, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

  const { data, isLoading, refetch } = useApiQuery(
    ['sync-prs', project.id, filter],
    `/admin/sync/projects/${project.id}/pull-requests${filter !== 'all' ? `?status=${filter}` : ''}`
  );
  const prs = data?.pull_requests || [];

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
        <Button size="sm" onClick={() => setShowNew(!showNew)}>
          <Plus className="w-4 h-4 mr-1" />
          New Pull Request
        </Button>
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
    </div>
  );
}
