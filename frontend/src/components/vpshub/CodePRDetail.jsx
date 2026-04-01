import { useState, useEffect } from 'react';
import { ArrowLeft, GitPullRequest, GitMerge, X, MessageSquare, FileCode, GitCommit, Send, Zap, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';
import DiffViewer from './DiffViewer';

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

export default function CodePRDetail({ owner, repo, prNumber, onBack }) {
  const [pr, setPr] = useState(null);
  const [diff, setDiff] = useState(null);
  const [files, setFiles] = useState([]);
  const [commits, setCommits] = useState([]);
  const [comments, setComments] = useState([]);
  const [tab, setTab] = useState('conversation');
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiResolving, setAiResolving] = useState(false);
  const [mergeError, setMergeError] = useState(null);

  useEffect(() => { loadPR(); }, [prNumber]);

  async function loadPR() {
    setLoading(true);
    try {
      const [prRes, diffRes, commentsRes] = await Promise.all([
        api.get(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}`),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/diff`),
        api.get(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/comments`),
      ]);
      setPr(prRes.data.pull);
      setDiff(diffRes.data.diff);
      setFiles(diffRes.data.files);
      setCommits(diffRes.data.commits);
      setComments(commentsRes.data.comments);
    } catch (err) {
      toast.error('Failed to load pull request');
    } finally {
      setLoading(false);
    }
  }

  async function handleMerge() {
    setMerging(true);
    setMergeError(null);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/merge`);
      if (data.success) {
        toast.success('Pull request merged!');
        loadPR();
      } else {
        setMergeError(data.error || 'Merge failed');
        toast.error(data.error || 'Merge failed');
      }
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Failed to merge';
      setMergeError(errMsg);
      toast.error(errMsg);
    } finally {
      setMerging(false);
    }
  }

  async function handleAiReview() {
    setAiReviewing(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/ai-review`);
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success('AI review completed');
        loadPR(); // Reload to show the AI review comment
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI review failed');
    } finally {
      setAiReviewing(false);
    }
  }

  async function handleAiResolve() {
    setAiResolving(true);
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/ai-resolve`);
      if (data.resolved) {
        toast.success('No conflicts — merge is clean!');
      } else if (data.resolutions) {
        toast.success(`AI resolved ${data.resolutions.length} conflict(s). Review below.`);
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI resolve failed');
    } finally {
      setAiResolving(false);
    }
  }

  async function handleClose() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/close`);
      toast.success('Pull request closed');
      loadPR();
    } catch (err) {
      toast.error('Failed to close PR');
    }
  }

  async function handleReopen() {
    try {
      await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/reopen`);
      toast.success('Pull request reopened');
      loadPR();
    } catch (err) {
      toast.error('Failed to reopen PR');
    }
  }

  async function handleAddComment(e) {
    e.preventDefault();
    if (!newComment.trim()) return;
    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/pulls/${prNumber}/comments`, {
        body: newComment,
      });
      setComments([...comments, data.comment]);
      setNewComment('');
    } catch (err) {
      toast.error('Failed to add comment');
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading...</div>;
  if (!pr) return <div className="text-center py-8 text-muted-foreground">Pull request not found</div>;

  const statusColor = {
    open: 'text-green-500',
    merged: 'text-purple-500',
    closed: 'text-zinc-400',
  };

  const statusIcon = {
    open: <GitPullRequest className="w-5 h-5" />,
    merged: <GitMerge className="w-5 h-5" />,
    closed: <X className="w-5 h-5" />,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to pull requests
        </button>
        <div className="flex items-start gap-3">
          <div className={`mt-1 ${statusColor[pr.status]}`}>{statusIcon[pr.status]}</div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{pr.title} <span className="text-muted-foreground font-normal">#{pr.pr_number}</span></h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${
                pr.status === 'open' ? 'bg-green-500/15 text-green-500 border-green-500/30' :
                pr.status === 'merged' ? 'bg-purple-500/15 text-purple-500 border-purple-500/30' :
                'bg-zinc-500/15 text-zinc-400 border-zinc-500/30'
              }`}>{pr.status}</span>
              <span>{pr.author_username} wants to merge</span>
              <span className="font-mono text-xs bg-accent px-1.5 py-0.5 rounded">{pr.source_branch}</span>
              <span>into</span>
              <span className="font-mono text-xs bg-accent px-1.5 py-0.5 rounded">{pr.target_branch}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-4">
        {[
          { key: 'conversation', label: 'Conversation', icon: MessageSquare, count: comments.length },
          { key: 'commits', label: 'Commits', icon: GitCommit, count: commits.length },
          { key: 'files', label: 'Files changed', icon: FileCode, count: files.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.count > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-accent rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'conversation' && (
        <div className="space-y-4">
          {/* PR description */}
          {pr.description && (
            <div className="border rounded-lg p-4 bg-card">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <span className="font-medium text-foreground">{pr.author_username}</span> commented {timeAgo(pr.created_at)}
              </div>
              <div className="text-sm whitespace-pre-wrap">{pr.description}</div>
            </div>
          )}

          {/* Comments */}
          {comments.map(comment => (
            <div key={comment.id} className="border rounded-lg p-4 bg-card">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <span className="font-medium text-foreground">{comment.author_username}</span>
                commented {timeAgo(comment.created_at)}
                {comment.file_path && (
                  <span className="font-mono bg-accent px-1 rounded">
                    {comment.file_path}{comment.line_number ? `:${comment.line_number}` : ''}
                  </span>
                )}
              </div>
              <div className="text-sm whitespace-pre-wrap">{comment.body}</div>
            </div>
          ))}

          {/* Merge info */}
          {pr.status === 'merged' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-sm">
              <GitMerge className="w-4 h-4 text-purple-500" />
              <span className="text-purple-400">
                {pr.merged_by_username} merged commit <span className="font-mono">{pr.merge_commit_sha?.slice(0, 7)}</span> {timeAgo(pr.merged_at)}
              </span>
            </div>
          )}

          {/* Add comment */}
          <form onSubmit={handleAddComment} className="border rounded-lg p-3 bg-card">
            <textarea
              className="w-full min-h-[80px] px-3 py-2 text-sm bg-background border rounded-md resize-y focus:outline-none focus:ring-1 focus:ring-primary mb-2"
              placeholder="Leave a comment..."
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-2 flex-wrap">
                {pr.status === 'open' && (
                  <>
                    <Button size="sm" onClick={handleAiReview} disabled={aiReviewing} variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
                      <Zap className="w-4 h-4 mr-1" /> {aiReviewing ? 'Reviewing...' : 'AI Review'}
                    </Button>
                    {mergeError && mergeError.includes('conflict') && (
                      <Button size="sm" onClick={handleAiResolve} disabled={aiResolving} variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10">
                        <Wand2 className="w-4 h-4 mr-1" /> {aiResolving ? 'Resolving...' : 'AI Resolve'}
                      </Button>
                    )}
                    <Button size="sm" onClick={handleMerge} disabled={merging} className="bg-purple-600 hover:bg-purple-700">
                      <GitMerge className="w-4 h-4 mr-1" /> {merging ? 'Merging...' : 'Merge'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleClose}>
                      <X className="w-4 h-4 mr-1" /> Close
                    </Button>
                  </>
                )}
                {pr.status === 'closed' && (
                  <Button size="sm" variant="outline" onClick={handleReopen}>Reopen</Button>
                )}
              </div>
              <Button type="submit" size="sm" disabled={!newComment.trim()}>
                <Send className="w-4 h-4 mr-1" /> Comment
              </Button>
            </div>
          </form>
        </div>
      )}

      {tab === 'commits' && (
        <div className="border rounded-lg divide-y">
          {commits.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No commits</div>
          ) : commits.map(c => (
            <div key={c.sha} className="flex items-center gap-3 p-3">
              <GitCommit className="w-4 h-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.message}</div>
                <div className="text-xs text-muted-foreground">{c.author_name} committed {timeAgo(c.date)}</div>
              </div>
              <span className="font-mono text-xs bg-accent px-2 py-0.5 rounded">{c.short_sha}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'files' && (
        <div>
          {/* Files summary */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
            <span>{files.length} file{files.length !== 1 ? 's' : ''} changed</span>
          </div>

          {/* File list */}
          <div className="border rounded-lg divide-y mb-4">
            {files.map(f => (
              <div key={f.path} className="flex items-center gap-2 p-2 text-sm">
                <span className={`w-5 text-center text-xs font-bold ${
                  f.status === 'A' ? 'text-green-500' : f.status === 'D' ? 'text-red-500' : 'text-yellow-500'
                }`}>
                  {f.status}
                </span>
                <span className="font-mono text-xs">{f.path}</span>
              </div>
            ))}
          </div>

          {/* Diff */}
          {diff && <DiffViewer diff={diff} />}
        </div>
      )}
    </div>
  );
}
