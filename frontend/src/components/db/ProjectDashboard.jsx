import { useState } from 'react';
import { Table2, Code2, Users, Key, Settings as SettingsIcon, CloudDownload, Download, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import TableEditor from './TableEditor';
import SqlEditor from './SqlEditor';
import Auth from './Auth';
import ApiKeys from './ApiKeys';
import Settings from './Settings';
import PullKeys from './PullKeys';
import SupabaseImport from './SupabaseImport';
import Buckets from './Buckets';

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

export default function ProjectDashboard({ project }) {
  const [activeSection, setActiveSection] = useState('tables');

  return (
    <div className="flex-1 flex min-h-0">
      {/* Supabase-style sidebar */}
      <div className="w-44 border-r bg-card flex flex-col">
        <div className="p-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors',
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
  );
}
