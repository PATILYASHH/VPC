import { useState, useEffect } from 'react';
import { Table2, Code2, Users, Key, Settings as SettingsIcon, CloudDownload, Download, HardDrive, ArrowUpRight, GitFork } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import TableEditor from './TableEditor';
import SqlEditor from './SqlEditor';
import Auth from './Auth';
import ApiKeys from './ApiKeys';
import Settings from './Settings';
import PullKeys from './PullKeys';
import SupabaseImport from './SupabaseImport';
import Buckets from './Buckets';
import PromoteDialog from './PromoteDialog';
import api from '@/lib/api';

const NAV_ITEMS = [
  { id: 'tables', label: 'Table Editor', icon: Table2 },
  { id: 'sql', label: 'SQL Editor', icon: Code2 },
  { id: 'auth', label: 'Auth', icon: Users },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'pull', label: 'Pull Keys', icon: Download },
  { id: 'storage', label: 'Buckets', icon: HardDrive },
  { id: 'import', label: 'Import', icon: CloudDownload },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const ENV_COLORS = {
  production: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  beta: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  development: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  staging: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

export default function ProjectDashboard({ project }) {
  const [activeSection, setActiveSection] = useState('tables');
  const [showPromote, setShowPromote] = useState(false);
  const [parentProject, setParentProject] = useState(null);

  const isFork = !!project?.forked_from;

  // Load parent project info for promote dialog
  useEffect(() => {
    if (!isFork) { setParentProject(null); return; }
    api.get(`/admin/db/projects/${project.forked_from}`)
      .then(({ data }) => setParentProject(data.project || data))
      .catch(() => setParentProject(null));
  }, [project?.forked_from, isFork]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Promote banner for forked projects */}
      {isFork && parentProject && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-blue-500/[0.03]">
          <GitFork className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs text-muted-foreground">
            Forked from <span className="font-medium text-foreground/80">{parentProject.name}</span>
          </span>
          {project.environment && (
            <Badge className={`text-[9px] ${ENV_COLORS[project.environment] || ''}`}>
              {project.environment}
            </Badge>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setShowPromote(true)}
          >
            <ArrowUpRight className="w-3.5 h-3.5" />
            Promote to Production
          </Button>
        </div>
      )}

      <div className="flex-1 flex flex-col sm:flex-row min-h-0">
        {/* Supabase-style sidebar - horizontal scroll on mobile */}
        <div className="sm:w-44 border-b sm:border-b-0 sm:border-r bg-card flex sm:flex-col shrink-0">
          <div className="p-2 flex sm:flex-col gap-0.5 overflow-x-auto sm:overflow-x-visible">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors whitespace-nowrap sm:w-full',
                    activeSection === item.id
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          {activeSection === 'tables' && <TableEditor project={project} />}
          {activeSection === 'sql' && <SqlEditor project={project} />}
          {activeSection === 'auth' && <Auth project={project} />}
          {activeSection === 'api' && <ApiKeys project={project} />}
          {activeSection === 'pull' && <PullKeys project={project} />}
          {activeSection === 'storage' && <Buckets project={project} />}
          {activeSection === 'import' && <SupabaseImport project={project} />}
          {activeSection === 'settings' && <Settings project={project} />}
        </div>
      </div>

      {/* Promote dialog */}
      {isFork && parentProject && (
        <PromoteDialog
          open={showPromote}
          onOpenChange={setShowPromote}
          betaProject={project}
          prodProject={parentProject}
        />
      )}
    </div>
  );
}
