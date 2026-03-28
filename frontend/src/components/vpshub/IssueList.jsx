import { useState, useEffect } from 'react';
import { CircleDot, Plus, MessageSquare, CheckCircle2, Tag } from 'lucide-react';
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
  return days < 30 ? `${days}d ago` : new Date(date).toLocaleDateString();
}

export default function IssueList({ owner, repo, onSelectIssue }) {
  const [issues, setIssues] = useState([]);
  const [counts, setCounts] = useState({ open: 0, closed: 0 });
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadIssues(); }, [owner, repo, filter]);

  async function loadIssues() {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/vpshub/repos/${owner}/${repo}/issues?status=${filter}`);
      setIssues(data.issues);
      setCounts(data.counts);
    } catch (err) {
      toast.error('Failed to load issues');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title) return;
    setCreating(true);
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/issues`, form);
      toast.success('Issue created');
      setShowCreate(false);
      setForm({ title: '', body: '' });
      loadIssues();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create issue');
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
            <CircleDot className="w-4 h-4" />
            {counts.open} Open
          </button>
          <button
            onClick={() => setFilter('closed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
              filter === 'closed' ? 'bg-zinc-500/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            {counts.closed} Closed
          </button>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-4 h-4 mr-1" /> New Issue
        </Button>
      </div>

      {/* Create Issue form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="border rounded-lg p-4 mb-4 space-y-3 bg-card">
          <Input
            placeholder="Issue title"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            autoFocus
          />
          <textarea
            className="w-full min-h-[100px] px-3 py-2 text-sm bg-background border rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Describe the issue... (supports markdown)"
            value={form.body}
            onChange={e => setForm({ ...form, body: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!form.title || creating}>
              {creating ? 'Creating...' : 'Submit Issue'}
            </Button>
          </div>
        </form>
      )}

      {/* Issue List */}
      {loading ? (
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      ) : issues.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CircleDot className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No {filter} issues</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {issues.map(issue => (
            <div
              key={issue.id}
              onClick={() => onSelectIssue(issue.issue_number)}
              className="flex items-start gap-3 p-3 hover:bg-accent/50 cursor-pointer transition-colors"
            >
              <div className="mt-1">
                {issue.status === 'open'
                  ? <CircleDot className="w-4 h-4 text-green-500" />
                  : <CheckCircle2 className="w-4 h-4 text-purple-500" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{issue.title}</span>
                  {(issue.labels || []).map(label => (
                    <span
                      key={label.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
                      style={{
                        backgroundColor: label.color + '20',
                        borderColor: label.color + '40',
                        color: label.color,
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  #{issue.issue_number} opened {timeAgo(issue.created_at)} by {issue.author_username}
                </div>
              </div>
              {issue.comment_count > 0 && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageSquare className="w-3.5 h-3.5" /> {issue.comment_count}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
