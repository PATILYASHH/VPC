import { useState } from 'react';
import { GitCommit, User, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function CommitHistory({ owner, repo, branch }) {
  const [offset, setOffset] = useState(0);
  const [copiedSha, setCopiedSha] = useState(null);
  const limit = 30;

  const { data, isLoading } = useApiQuery(
    ['vpshub-commits', owner, repo, branch, offset],
    `/admin/vpshub/repos/${owner}/${repo}/commits/${branch}?limit=${limit}&offset=${offset}`
  );

  const commits = data?.commits || [];
  const total = data?.total || 0;

  function copySha(sha) {
    navigator.clipboard.writeText(sha);
    setCopiedSha(sha);
    setTimeout(() => setCopiedSha(null), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <GitCommit className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'commit' : 'commits'} on <span className="font-medium text-foreground">{branch}</span>
        </p>
      </div>

      <div className="space-y-1">
        {commits.map(commit => (
          <div
            key={commit.sha}
            className="flex items-start gap-3 border rounded-lg p-3 bg-card hover:bg-accent/20 transition-colors"
          >
            <GitCommit className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{commit.message}</p>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {commit.author_name}
                </span>
                <span>{timeAgo(commit.date)}</span>
              </div>
            </div>
            <button
              onClick={() => copySha(commit.sha)}
              className="flex items-center gap-1 px-2 py-1 rounded border bg-background text-xs font-mono hover:bg-accent transition-colors shrink-0"
              title="Copy full SHA"
            >
              {copiedSha === commit.sha ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3 opacity-50" />
              )}
              {commit.short_sha}
            </button>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
