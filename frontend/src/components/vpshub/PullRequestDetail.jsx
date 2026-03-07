import { useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, GitMerge, XCircle, RotateCcw, Play, Clock, User,
  CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import PRStatusBadge from './PRStatusBadge';
import SqlDiffViewer from './SqlDiffViewer';
import api from '@/lib/api';

export default function PullRequestDetail({ project, prNumber, onBack }) {
  const [testing, setTesting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: pr, isLoading, refetch } = useApiQuery(
    ['sync-pr', project.id, prNumber],
    `/admin/sync/projects/${project.id}/pull-requests/${prNumber}`
  );

  async function handleTest() {
    setTesting(true);
    try {
      const { data } = await api.post(
        `/admin/sync/projects/${project.id}/pull-requests/${prNumber}/test`
      );
      if (data.sandbox_result?.success) {
        toast.success('Sandbox test passed!');
      } else {
        toast.error(`Sandbox test failed: ${data.sandbox_result?.error || 'Unknown error'}`);
      }
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  async function handleMerge() {
    setMerging(true);
    try {
      await api.post(
        `/admin/sync/projects/${project.id}/pull-requests/${prNumber}/merge`
      );
      toast.success('Pull request merged! Migration applied to database.');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Merge failed');
    } finally {
      setMerging(false);
    }
  }

  async function handleClose() {
    setClosing(true);
    try {
      await api.post(
        `/admin/sync/projects/${project.id}/pull-requests/${prNumber}/close`
      );
      toast.success('Pull request closed');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Close failed');
    } finally {
      setClosing(false);
    }
  }

  async function handleReopen() {
    try {
      await api.post(
        `/admin/sync/projects/${project.id}/pull-requests/${prNumber}/reopen`
      );
      toast.success('Pull request reopened');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reopen failed');
    }
  }

  function timeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (isLoading || !pr) {
    return (
      <div className="p-4">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const canMerge = pr.status === 'open' && pr.sandbox_result?.success && !pr.conflict_result?.has_conflicts;
  const isOpen = pr.status === 'open';
  const isClosed = pr.status === 'closed';
  const isMerged = pr.status === 'merged';

  return (
    <div className="space-y-4">
      {/* Back Button */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to pull requests
      </button>

      {/* Header */}
      <div className="border rounded-lg bg-card p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PRStatusBadge status={pr.status} />
              <span className="text-xs text-muted-foreground">#{pr.pr_number}</span>
            </div>
            <h2 className="text-lg font-semibold">{pr.title}</h2>
            {pr.description && (
              <p className="text-sm text-muted-foreground mt-1">{pr.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {pr.submitted_by}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Created {timeAgo(pr.created_at)}
          </span>
          {pr.merged_by && (
            <span className="flex items-center gap-1">
              <GitMerge className="w-3 h-3 text-purple-400" />
              Merged by {pr.merged_by} {timeAgo(pr.merged_at)}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        {(isOpen || isClosed) && (
          <div className="flex gap-2 mt-4 pt-4 border-t">
            {isOpen && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                >
                  <Play className={`w-4 h-4 mr-1 ${testing ? 'animate-spin' : ''}`} />
                  {testing ? 'Testing...' : 'Test in Sandbox'}
                </Button>

                <Button
                  size="sm"
                  onClick={handleMerge}
                  disabled={merging || !canMerge}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  <GitMerge className="w-4 h-4 mr-1" />
                  {merging ? 'Merging...' : 'Merge Pull Request'}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClose}
                  disabled={closing}
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10 ml-auto"
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Close
                </Button>
              </>
            )}

            {isClosed && (
              <Button size="sm" variant="outline" onClick={handleReopen}>
                <RotateCcw className="w-4 h-4 mr-1" />
                Reopen
              </Button>
            )}
          </div>
        )}

        {isOpen && !pr.sandbox_result && (
          <div className="flex items-center gap-2 mt-3 p-2 bg-blue-500/5 border border-blue-500/20 rounded text-xs text-blue-400">
            <Info className="w-4 h-4 shrink-0" />
            Run a sandbox test before merging. This validates the SQL without affecting your database.
          </div>
        )}
      </div>

      {/* Sandbox Result */}
      {pr.sandbox_result && (
        <div className={`border rounded-lg p-4 ${
          pr.sandbox_result.success
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-red-500/5 border-red-500/20'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {pr.sandbox_result.success ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-400">Sandbox Test Passed</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm font-medium text-red-400">Sandbox Test Failed</span>
              </>
            )}
          </div>

          {/* Success details */}
          {pr.sandbox_result.success && (
            <div className="space-y-1 mt-2">
              {pr.sandbox_result.tables_added?.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-emerald-400 font-medium">Tables created:</span>
                  <div className="flex flex-wrap gap-1">
                    {pr.sandbox_result.tables_added.map((t) => (
                      <Badge key={t} variant="outline" className="text-emerald-300 border-emerald-500/30 text-[11px]">
                        + {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {pr.sandbox_result.tables_removed?.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-red-400 font-medium">Tables dropped:</span>
                  <div className="flex flex-wrap gap-1">
                    {pr.sandbox_result.tables_removed.map((t) => (
                      <Badge key={t} variant="outline" className="text-red-300 border-red-500/30 text-[11px]">
                        - {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {pr.sandbox_result.tables_after != null && (
                <span className="text-xs text-muted-foreground">
                  Total tables after apply: {pr.sandbox_result.tables_after}
                </span>
              )}
            </div>
          )}

          {/* Error details */}
          {pr.sandbox_result.error && (
            <pre className="text-xs font-mono text-red-300 bg-red-500/10 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap">
              {pr.sandbox_result.error}
            </pre>
          )}
          {pr.sandbox_result.position && (
            <span className="text-xs text-red-300/70 mt-1 block">
              Error at position: {pr.sandbox_result.position}
            </span>
          )}
        </div>
      )}

      {/* Conflict Result */}
      {pr.conflict_result?.has_conflicts && (
        <div className="border rounded-lg p-4 bg-amber-500/5 border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-amber-400">Conflicts Detected</span>
          </div>
          <div className="space-y-1">
            {pr.conflict_result.conflicts?.map((c, i) => (
              <div key={i} className="text-xs text-amber-300 font-mono flex items-center gap-2">
                <span className="text-amber-400">{c.type}</span>
                <span>{c.object}</span>
                <span className="text-muted-foreground">- {c.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Merge Info */}
      {isMerged && pr.migration_id && (
        <div className="border rounded-lg p-4 bg-purple-500/5 border-purple-500/20">
          <div className="flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium text-purple-400">Merged into database</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Migration created and applied. View it in the Migrations tab.
          </p>
        </div>
      )}

      {/* SQL Content */}
      <SqlDiffViewer sql={pr.sql_content} title="SQL Changes" />

      {/* SQL Down (Rollback) */}
      {pr.sql_down && (
        <SqlDiffViewer sql={pr.sql_down} title="Rollback SQL (auto-generated)" maxHeight="200px" />
      )}
    </div>
  );
}
