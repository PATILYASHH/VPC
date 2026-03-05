import { useState } from 'react';
import { Table2, Code2, Users, Key, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import BanaTableEditor from './BanaTableEditor';
import BanaSqlEditor from './BanaSqlEditor';
import BanaAuth from './BanaAuth';
import BanaApiKeys from './BanaApiKeys';
import BanaSettings from './BanaSettings';

const NAV_ITEMS = [
  { id: 'tables', label: 'Table Editor', icon: Table2 },
  { id: 'sql', label: 'SQL Editor', icon: Code2 },
  { id: 'auth', label: 'Auth', icon: Users },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'settings', label: 'Settings', icon: Settings },
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
        {activeSection === 'tables' && <BanaTableEditor project={project} />}
        {activeSection === 'sql' && <BanaSqlEditor project={project} />}
        {activeSection === 'auth' && <BanaAuth project={project} />}
        {activeSection === 'api' && <BanaApiKeys project={project} />}
        {activeSection === 'settings' && <BanaSettings project={project} />}
      </div>
    </div>
  );
}
