import { useState } from 'react';
import { GitMerge, GitBranch, Database, Key } from 'lucide-react';
import ProjectsGrid from '@/components/vpshub/ProjectsGrid';
import ProjectView from '@/components/vpshub/ProjectView';
import RepoList from '@/components/vpshub/RepoList';
import RepoView from '@/components/vpshub/RepoView';
import TokenManager from '@/components/vpshub/TokenManager';

const MODES = {
  repos: { label: 'Repositories', icon: GitBranch },
  database: { label: 'Database', icon: Database },
  tokens: { label: 'Access Tokens', icon: Key },
};

export default function VPSHub() {
  const [mode, setMode] = useState('repos');
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState(null);

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-card">
        <GitMerge className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">VPSHub</span>
        <span className="text-xs text-muted-foreground">Code Hosting & Collaboration</span>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 ml-auto">
          {Object.entries(MODES).map(([key, { label, icon: Icon }]) => (
            <button
              key={key}
              onClick={() => {
                setMode(key);
                setSelectedProject(null);
                setSelectedRepo(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                mode === key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
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
