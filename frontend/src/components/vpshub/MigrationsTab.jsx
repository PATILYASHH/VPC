import { useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, Clock, User, RotateCcw, CheckCircle2,
  XCircle, CircleDot, AlertCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import SqlDiffViewer from './SqlDiffViewer';
import api from '@/lib/api';

const STATUS_CONFIG = {
  applied:     { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2, label: 'Applied' },
  pending:     { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: CircleDot, label: 'Pending' },
  rolled_back: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: RotateCcw, label: 'Rolled Back' },
  failed:      { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle, label: 'Failed' },
};

export default function MigrationsTab({ project }) {
  const [expandedId, setExpandedId] = useState(null);
  const [rollingBack, setRollingBack] = useState(null);

  const { data, isLoading, refetch } = useApiQuery(
    ['sync-migrations', project.id],
    `/admin/sync/projects/${project.id}/migrations`
  );
  const migrations = data?.migrations || [];

  const { data: changesData } = useApiQuery(
    ['sync-changes', project.id],
    `/admin/sync/projects/${project.id}/changes`
  );
  const changes = changesData?.changes || [];

  async function handleRollback(migrationId) {
    setRollingBack(migrationId);
    try {
      await api.post(`/admin/sync/projects/${project.id}/migrations/${migrationId}/rollback`);
      toast.success('Migration rolled back');
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Pending Changes Banner */}
      {changes.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-amber-400 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {changes.length} Pending Schema Changes
          </h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {changes.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <span className="text-amber-400">{c.event_type}</span>
                <span className="text-foreground">{c.object_type}</span>
                <span>{c.object_identity?.split('.').pop()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-sm font-medium text-muted-foreground">Migration Timeline</h3>

      {migrations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No migrations yet. Merge a pull request to create one.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[19px] top-6 bottom-6 w-px bg-border" />
          <div className="space-y-3">
            {migrations.map(m => {
              const cfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.pending;
              const StatusIcon = cfg.icon;
              const isExpanded = expandedId === m.id;

              return (
                <div key={m.id} className="relative pl-10">
                  <div className="absolute left-2.5 top-3 w-4 h-4 rounded-full bg-background border-2 border-border flex items-center justify-center">
                    <div className={`w-2 h-2 rounded-full ${
                      m.status === 'applied' ? 'bg-emerald-400' :
                      m.status === 'failed' ? 'bg-red-400' :
                      m.status === 'rolled_back' ? 'bg-blue-400' : 'bg-amber-400'
                    }`} />
                  </div>

                  <div className="border rounded-lg bg-card overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : m.id)}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      <Badge variant="outline" className="text-xs font-mono">v{m.version}</Badge>
                      <span className="text-sm font-medium flex-1 truncate">{m.name || `migration_v${m.version}`}</span>
                      <Badge variant="outline" className={`text-xs ${cfg.color}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {cfg.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(m.applied_at || m.created_at).toLocaleDateString()}
                      </span>
                      {m.applied_by && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {m.applied_by}
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Source: {m.source}</Badge>
                          {m.checksum && (
                            <Badge variant="outline" className="text-xs">
                              Checksum: {m.checksum.substring(0, 12)}...
                            </Badge>
                          )}
                        </div>

                        <SqlDiffViewer sql={m.sql_up} title="SQL (Up)" maxHeight="200px" />
                        {m.sql_down && <SqlDiffViewer sql={m.sql_down} title="SQL (Rollback)" maxHeight="150px" />}

                        {m.status === 'applied' && m.sql_down && (
                          <div className="pt-2 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                              onClick={() => handleRollback(m.id)}
                              disabled={rollingBack === m.id}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              {rollingBack === m.id ? 'Rolling back...' : 'Rollback'}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
