import { useState, useEffect } from 'react';
import { ArrowLeft, CircleDot, CheckCircle2, Send, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export default function IssueDetail({ owner, repo, issueNumber, onBack }) {
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadIssue(); }, [issueNumber]);

  async function loadIssue() {
    setLoading(true);
    try {
      const [issueRes, commentsRes] = await Promise.all([
        api.get(`/admin/vpshub/repos/${owner}/${repo}/issues/${issueNumber}`),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/issues/${issueNumber}/comments`),
      ]);
      setIssue(issueRes.data.issue);
      setComments(commentsRes.data.comments);
    } catch (err) {
      toast.error('Failed to load issue');
    } finally {
      setLoading(false);
    }
  }

  async function handleClose() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/issues/${issueNumber}/close`);
      toast.success('Issue closed');
      loadIssue();
    } catch (err) {
      toast.error('Failed to close issue');
    }
  }

  async function handleReopen() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/issues/${issueNumber}/reopen`);
      toast.success('Issue reopened');
      loadIssue();
    } catch (err) {
      toast.error('Failed to reopen issue');
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
        body: newComment,
      });
      setComments([...comments, data.comment]);
      setNewComment('');
    } catch (err) {
      toast.error('Failed to add comment');
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  if (!issue) return <div className="text-center py-8 text-muted-foreground">Issue not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to issues
        </button>
        <div className="flex items-start gap-3">
          <div className="mt-1">
            {issue.status === 'open'
              ? <CircleDot className="w-5 h-5 text-green-500" />
              : <CheckCircle2 className="w-5 h-5 text-purple-500" />
            }
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {issue.title} <span className="text-muted-foreground font-normal">#{issue.issue_number}</span>
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${
                issue.status === 'open'
                  ? 'bg-green-500/15 text-green-500 border-green-500/30'
                  : 'bg-purple-500/15 text-purple-500 border-purple-500/30'
              }`}>{issue.status}</span>
              <span>{issue.author_username} opened this issue {timeAgo(issue.created_at)}</span>
              {issue.closed_at && (
                <span>· closed {timeAgo(issue.closed_at)}</span>
              )}
            </div>
            {/* Labels */}
            {(issue.labels || []).length > 0 && (
              <div className="flex gap-1.5 mt-2">
                {issue.labels.map(label => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
                    style={{
                      backgroundColor: label.color + '20',
                      borderColor: label.color + '40',
                      color: label.color,
                    }}
                  >
                    <Tag className="w-3 h-3" /> {label.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body + Comments */}
      <div className="space-y-4">
        {/* Issue body */}
        {issue.body && (
          <div className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{issue.author_username}</span> opened this issue {timeAgo(issue.created_at)}
            </div>
            <div className="text-sm whitespace-pre-wrap">{issue.body}</div>
          </div>
        )}

        {/* Comments */}
        {comments.map(comment => (
          <div key={comment.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <span className="font-medium text-foreground">{comment.author_username}</span>
              commented {timeAgo(comment.created_at)}
            </div>
            <div className="text-sm whitespace-pre-wrap">{comment.body}</div>
          </div>
        ))}

        {/* Closed info */}
        {issue.status === 'closed' && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm">
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
            <span className="text-purple-400">
              {issue.closed_by_username || 'Someone'} closed this issue {timeAgo(issue.closed_at)}
            </span>
          </div>
        )}

        {/* Add comment + actions */}
        <form onSubmit={handleAddComment} className="border rounded-lg p-3 bg-card">
          <textarea
            className="w-full min-h-[80px] px-3 py-2 text-sm bg-background border rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-primary mb-2"
            placeholder="Leave a comment..."
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <div>
              {issue.status === 'open' ? (
                <Button size="sm" variant="outline" onClick={handleClose}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Close issue
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={handleReopen}>
                  <CircleDot className="w-4 h-4 mr-1" /> Reopen issue
                </Button>
              )}
            </div>
            <Button type="submit" size="sm" disabled={!newComment.trim()}>
              <Send className="w-4 h-4 mr-1" /> Comment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
