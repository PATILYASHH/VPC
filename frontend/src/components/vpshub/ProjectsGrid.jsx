import { GitPullRequest, GitMerge, AlertTriangle, Database, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useApiQuery } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

export default function ProjectsGrid({ onSelectProject }) {
  const { data: projectsData, isLoading } = useApiQuery('bana-projects', '/admin/bana/projects');
  const { data: summaryData } = useApiQuery('sync-summary', '/admin/sync/summary');

  const projects = projectsData?.projects || [];
  const summaries = summaryData?.summaries || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Database className="w-16 h-16 mb-4 opacity-30" />
        <p className="text-lg font-medium mb-1">No Projects</p>
        <p className="text-sm">Create a DB project first.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Projects</h2>
        <p className="text-sm text-muted-foreground mt-1">Select a project to manage pull requests and migrations.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(project => {
          const summary = summaries.find(s => s.project_id === project.id) || {};
          const openPRs = parseInt(summary.open_prs) || 0;
          const mergedPRs = parseInt(summary.merged_prs) || 0;
          const conflictPRs = parseInt(summary.conflict_prs) || 0;

          return (
            <button
              key={project.id}
              onClick={() => onSelectProject(project)}
              className="text-left border rounded-lg bg-card p-5 hover:border-primary/50 hover:bg-accent/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                    {project.name}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{project.slug}</p>
                </div>
                <Database className="w-5 h-5 text-muted-foreground/50" />
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {openPRs > 0 && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">
                    <GitPullRequest className="w-3 h-3 mr-1" />
                    {openPRs} open
                  </Badge>
                )}
                {conflictPRs > 0 && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    {conflictPRs} conflict
                  </Badge>
                )}
                {mergedPRs > 0 && (
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs">
                    <GitMerge className="w-3 h-3 mr-1" />
                    {mergedPRs} merged
                  </Badge>
                )}
                {openPRs === 0 && mergedPRs === 0 && conflictPRs === 0 && (
                  <span className="text-xs text-muted-foreground">No pull requests yet</span>
                )}
              </div>

              {project.pull_tracking_enabled && (
                <div className="flex items-center gap-1 mt-3 text-xs text-emerald-400">
                  <Clock className="w-3 h-3" />
                  Tracking enabled
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
