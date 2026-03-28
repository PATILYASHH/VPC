import { useState } from 'react';
import { GitMerge, GitBranch, Database, Key, Globe, Layers, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiQuery } from '@/hooks/useApi';
import ProjectsGrid from '@/components/vpshub/ProjectsGrid';
import ProjectView from '@/components/vpshub/ProjectView';
import RepoList from '@/components/vpshub/RepoList';
import RepoView from '@/components/vpshub/RepoView';
import TokenManager from '@/components/vpshub/TokenManager';

const MODES = [
  { id: 'repos', label: 'Repositories', icon: GitBranch },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'tokens', label: 'Tokens', icon: Key },
];

export default function VPSHub() {
  const [mode, setMode] = useState('repos');
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);

  // Fetch summary stats for the header
  const { data: repoData } = useApiQuery('vpshub-repos', '/admin/vpshub/repos');
  const repoCount = repoData?.repos?.length || 0;

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-foreground">
      {/* Top Bar */}
      <div className="border-b border-white/[0.06] bg-[#161b22]">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <GitMerge className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-sm leading-tight">VPSHub</span>
              <span className="text-[10px] text-muted-foreground/60 leading-tight">Code, Deploy & Collaborate</span>
            </div>
          </div>

          {/* Stats chips */}
          <div className="flex items-center gap-2 ml-3">
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.04] text-[10px] text-muted-foreground">
              <GitBranch className="w-3 h-3" /> {repoCount} repos
            </span>
          </div>

          {/* Mode tabs */}
          <div className="flex items-center gap-0.5 ml-auto bg-white/[0.04] rounded-lg p-0.5">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setMode(id);
                  setSelectedProject(null);
                  setSelectedRepo(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                  mode === id
                    ? 'bg-white/[0.1] text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {mode === 'repos' && (
          selectedRepo ? (
            <RepoView repo={selectedRepo} onBack={() => setSelectedRepo(null)} />
          ) : (
            <RepoList onSelectRepo={setSelectedRepo} />
          )
        )}

        {mode === 'database' && (
          selectedProject ? (
            <ProjectView
              project={selectedProject}
              onBack={() => setSelectedProject(null)}
            />
          ) : (
            <ProjectsGrid onSelectProject={setSelectedProject} />
          )
        )}

        {mode === 'tokens' && (
          <TokenManager />
        )}
      </div>
    </div>
  );
}
