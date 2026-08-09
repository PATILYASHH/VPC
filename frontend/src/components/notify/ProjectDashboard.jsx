import { useState } from 'react';
import { LayoutDashboard, Smartphone, Key, Send, Settings as SettingsIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import Overview from './Overview';
import Devices from './Devices';
import ApiKeys from './ApiKeys';
import Compose from './Compose';
import Settings from './Settings';

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'api', label: 'API Keys', icon: Key },
  { id: 'compose', label: 'Compose', icon: Send },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function ProjectDashboard({ project }) {
  const [activeSection, setActiveSection] = useState('overview');

  return (
    <div className="flex-1 flex flex-col sm:flex-row min-h-0">
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

      <div className="flex-1 min-w-0">
        {activeSection === 'overview' && <Overview project={project} />}
        {activeSection === 'devices' && <Devices project={project} />}
        {activeSection === 'api' && <ApiKeys project={project} />}
        {activeSection === 'compose' && <Compose project={project} />}
        {activeSection === 'settings' && <Settings project={project} />}
      </div>
    </div>
  );
}
