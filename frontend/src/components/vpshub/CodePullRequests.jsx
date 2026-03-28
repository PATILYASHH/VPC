import { useState, useEffect } from 'react';
import { GitPullRequest, Plus, MessageSquare, GitMerge, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '@/lib/api';
import { toast } from 'sonner';

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function StatusBadge({ status }) {
  const styles = {
    open: 'bg-green-500/15 text-green-500 border-green-500/30',
    merged: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
    closed: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  };
  const icons = {
    open: <GitPullRequest className="w-3 h-3" />,
    merged: <GitMerge className="w-3 h-3" />,
    closed: <X className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${styles[status] || styles.open}`}>
      {icons[status]} {status}
    </span>
  );
}

export default function CodePullRequests({ owner, repo, branches, onSelectPR }) {
  const [prs, setPrs] = useState([]);
  const [counts, setCounts] = useState({ open: 0, closed: 0, merged: 0 });
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', sourceBranch: '', targetBranch: 'main' });
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadPRs(); }, [owner, repo, filter]);

  async function loadPRs() {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/vpshub/repos/${owner}/${repo}/pulls?status=${filter}`);
      setPrs(data.pulls);
      setCounts(data.counts);
    } catch (err) {
      toast.error('Failed to load pull requests');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title || !form.sourceBranch) return;
    setCreating(true);
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls`, form);
      toast.success('Pull request created');
      setShowCreate(false);
      setForm({ title: '', description: '', sourceBranch: '', targetBranch: 'main' });
      loadPRs();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create PR');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('open')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === 'open' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitPullRequest className="w-4 h-4" />
            {counts.open} Open
          </button>
          <button
            onClick={() => setFilter('closed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === 'closed' ? 'bg-zinc-500/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Check className="w-4 h-4" />
            {counts.closed} Closed
          </button>
          <button
            onClick={() => setFilter('merged')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === 'merged' ? 'bg-purple-500/10 text-purple-400 font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GitMerge className="w-4 h-4" />
            {counts.merged} Merged
          </button>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-1" /> New Pull Request
        </Button>
      </div>

      {/* Create PR form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="border rounded-lg p-4 mb-4 space-y-3 bg-card">
          <Input
            placeholder="PR title"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <textarea
            className="w-full min-h-[80px] px-3 py-2 text-sm bg-background border rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Description (optional, supports markdown)"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Source branch</label>
              <select
                className="w-full px-3 py-2 text-sm bg-background border rounded-md"
                value={form.sourceBranch}
                onChange={e => setForm({ ...form, sourceBranch: e.target.value })}
              >
                <option value="">Select branch...</option>
                {(branches || []).filter(b => b.name !== form.targetBranch).map(b => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end text-muted-foreground text-sm pb-2">into</div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Target branch</label>
              <select
                className="w-full px-3 py-2 text-sm bg-background border rounded-md"
                value={form.targetBranch}
                onChange={e => setForm({ ...form, targetBranch: e.target.value })}
              >
                {(branches || []).map(b => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!form.title || !form.sourceBranch || creating}>
              {creating ? 'Creating...' : 'Create Pull Request'}
            </Button>
          </div>
        </form>
      )}

      {/* PR List */}
      {loading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : prs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <GitPullRequest className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No {filter} pull requests</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {prs.map(pr => (
            <div
              key={pr.id}
              onClick={() => onSelectPR(pr.pr_number)}
              className="flex items-start gap-3 p-3 hover:bg-accent/50 cursor-pointer transition-colors"
            >
              <div className="mt-1">
                {pr.status === 'open' && <GitPullRequest className="w-4 h-4 text-green-500" />}
                {pr.status === 'merged' && <GitMerge className="w-4 h-4 text-purple-500" />}
                {pr.status === 'closed' && <X className="w-4 h-4 text-zinc-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{pr.title}</span>
                  <StatusBadge status={pr.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  #{pr.pr_number} opened {timeAgo(pr.created_at)} by {pr.author_username}
                  <span className="mx-1.5">·</span>
                  <span className="font-mono text-xs">{pr.source_branch}</span>
                  <span className="mx-1"> → </span>
                  <span className="font-mono text-xs">{pr.target_branch}</span>
                </div>
              </div>
              {pr.comment_count > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="w-3.5 h-3.5" /> {pr.comment_count}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
