import { useState } from 'react';
import { GitBranch, Lock, Globe, Plus, Clock, HardDrive, Database, Layers, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import NewRepoDialog from './NewRepoDialog';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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

export default function RepoList({ onSelectRepo }) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const { data, isLoading, refetch } = useApiQuery('vpshub-repos', '/admin/vpshub/repos');

  const repos = data?.repos || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Repositories</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} size="sm" className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          New Repository
        </Button>
      </div>

      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mb-4">
            <GitBranch className="w-8 h-8 text-violet-400/40" />
          </div>
          <p className="text-base font-medium mb-1 text-foreground/70">No repositories yet</p>
          <p className="text-sm mb-4">Create your first repository to get started.</p>
          <Button onClick={() => setShowNewDialog(true)} variant="outline" size="sm" className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Create Repository
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {repos.map(repo => (
            <button
              key={repo.id}
              onClick={() => onSelectRepo(repo)}
              className="text-left border border-white/[0.06] rounded-xl bg-white/[0.02] p-4 hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-150 group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="font-semibold text-sm truncate group-hover:text-violet-400 transition-colors">
                    {repo.owner_username}/{repo.name}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 ml-2 text-[10px] px-1.5 py-0 h-5 border-white/[0.08] ${
                    repo.visibility === 'public' ? 'text-emerald-400' : 'text-muted-foreground'
                  }`}
                >
                  {repo.visibility === 'public' ? (
                    <Globe className="w-2.5 h-2.5 mr-1" />
                  ) : (
                    <Lock className="w-2.5 h-2.5 mr-1" />
                  )}
                  {repo.visibility}
                </Badge>
              </div>

              {repo.description && (
                <p className="text-xs text-muted-foreground/70 mb-3 line-clamp-2">{repo.description}</p>
              )}

              {/* Connected services badges */}
              {(repo.linked_project_id || repo.linked_hosting_id) && (
                <div className="flex items-center gap-1.5 mb-3">
                  {repo.linked_project_id && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-400 border border-emerald-500/20">
                      <Database className="w-2.5 h-2.5" /> DB
                    </span>
                  )}
                  {repo.linked_hosting_id && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-[10px] text-blue-400 border border-blue-500/20">
                      <Globe className="w-2.5 h-2.5" /> Hosting
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50">
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {formatBytes(repo.size_bytes)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {timeAgo(repo.updated_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {showNewDialog && (
        <NewRepoDialog
          onClose={() => setShowNewDialog(false)}
          onCreated={(repo) => {
            setShowNewDialog(false);
            refetch();
            onSelectRepo(repo);
          }}
        />
      )}
    </div>
  );
}
