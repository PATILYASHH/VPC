import { useState } from 'react';
import { GitBranch, Lock, Globe, Plus, Clock, HardDrive } from 'lucide-react';
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
          <h2 className="text-xl font-semibold">Repositories</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {repos.length} {repos.length === 1 ? 'repository' : 'repositories'}
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Repository
        </Button>
      </div>

      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <GitBranch className="w-16 h-16 mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No repositories yet</p>
          <p className="text-sm mb-4">Create your first repository to get started.</p>
          <Button onClick={() => setShowNewDialog(true)} variant="outline" className="gap-2">
            <Plus className="w-4 h-4" />
            Create Repository
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map(repo => (
            <button
              key={repo.id}
              onClick={() => onSelectRepo(repo)}
              className="text-left border rounded-lg bg-card p-5 hover:border-primary/50 hover:bg-accent/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranch className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
                    {repo.owner_username}/{repo.name}
                  </span>
                </div>
                <Badge variant={repo.visibility === 'public' ? 'secondary' : 'outline'} className="shrink-0 ml-2">
                  {repo.visibility === 'public' ? (
                    <Globe className="w-3 h-3 mr-1" />
                  ) : (
                    <Lock className="w-3 h-3 mr-1" />
                  )}
                  {repo.visibility}
                </Badge>
              </div>

              {repo.description && (
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{repo.description}</p>
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-auto">
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
