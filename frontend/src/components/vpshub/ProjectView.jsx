import { useState } from 'react';
import { GitPullRequest, GitMerge, Table2, Settings, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import PullRequestsTab from './PullRequestsTab';
import PullRequestDetail from './PullRequestDetail';
import MigrationsTab from './MigrationsTab';
import SchemaTab from './SchemaTab';
import SettingsTab from './SettingsTab';

const TABS = [
  { key: 'prs', label: 'Pull Requests', icon: GitPullRequest },
  { key: 'migrations', label: 'Migrations', icon: GitMerge },
  { key: 'schema', label: 'Schema', icon: Table2 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function ProjectView({ project, onBack }) {
  const [activeTab, setActiveTab] = useState('prs');
  const [selectedPR, setSelectedPR] = useState(null);
  const queryClient = useQueryClient();

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ['sync-prs'] });
    queryClient.invalidateQueries({ queryKey: ['sync-pr'] });
    queryClient.invalidateQueries({ queryKey: ['sync-migrations'] });
    queryClient.invalidateQueries({ queryKey: ['sync-changes'] });
    queryClient.invalidateQueries({ queryKey: ['sync-schema'] });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card text-sm">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          Projects
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">{project.name}</span>
        <span className="text-xs text-muted-foreground font-mono">({project.slug})</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={refreshAll}>
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Nav */}
        <div className="w-48 border-r bg-card flex flex-col">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelectedPR(null); }}
                className={`flex items-center gap-2 px-3 py-2.5 text-sm w-full text-left transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'prs' && !selectedPR && (
            <PullRequestsTab project={project} onSelectPR={pr => setSelectedPR(pr)} />
          )}
          {activeTab === 'prs' && selectedPR && (
            <PullRequestDetail
              project={project}
              prNumber={selectedPR.pr_number}
              onBack={() => setSelectedPR(null)}
            />
          )}
          {activeTab === 'migrations' && <MigrationsTab project={project} />}
          {activeTab === 'schema' && <SchemaTab project={project} />}
          {activeTab === 'settings' && <SettingsTab project={project} />}
        </div>
      </div>
    </div>
  );
}
