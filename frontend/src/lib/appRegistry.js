import { Server, Database, Key, Activity, HardDrive, FileText, Terminal, Layers } from 'lucide-react';
import ServerManager from '@/components/apps/ServerManager';
import DatabaseManager from '@/components/apps/DatabaseManager';
import ApiKeyManager from '@/components/apps/ApiKeyManager';
import IntegrationMonitor from '@/components/apps/IntegrationMonitor';
import BackupManager from '@/components/apps/BackupManager';
import LogsViewer from '@/components/apps/LogsViewer';
import DeveloperTerminal from '@/components/apps/DeveloperTerminal';
import BanaDB from '@/components/apps/BanaDB';

const APP_REGISTRY = {
  'server-manager': {
    id: 'server-manager',
    title: 'Server Manager',
    icon: Server,
    component: ServerManager,
    defaultWidth: 1000,
    defaultHeight: 650,
    minWidth: 600,
    minHeight: 400,
  },
  'database-manager': {
    id: 'database-manager',
    title: 'Database Manager',
    icon: Database,
    component: DatabaseManager,
    defaultWidth: 1200,
    defaultHeight: 700,
    minWidth: 800,
    minHeight: 500,
  },
  'api-key-manager': {
    id: 'api-key-manager',
    title: 'API Keys',
    icon: Key,
    component: ApiKeyManager,
    defaultWidth: 850,
    defaultHeight: 550,
    minWidth: 500,
    minHeight: 350,
  },
  'integration-monitor': {
    id: 'integration-monitor',
    title: 'Integrations',
    icon: Activity,
    component: IntegrationMonitor,
    defaultWidth: 900,
    defaultHeight: 550,
    minWidth: 500,
    minHeight: 350,
  },
  'backup-manager': {
    id: 'backup-manager',
    title: 'Backups',
    icon: HardDrive,
    component: BackupManager,
    defaultWidth: 800,
    defaultHeight: 500,
    minWidth: 500,
    minHeight: 300,
  },
  'logs-viewer': {
    id: 'logs-viewer',
    title: 'Logs',
    icon: FileText,
    component: LogsViewer,
    defaultWidth: 1000,
    defaultHeight: 600,
    minWidth: 600,
    minHeight: 400,
  },
  'developer-terminal': {
    id: 'developer-terminal',
    title: 'Terminal',
    icon: Terminal,
    component: DeveloperTerminal,
    defaultWidth: 800,
    defaultHeight: 500,
    minWidth: 500,
    minHeight: 300,
  },
  'bana-db': {
    id: 'bana-db',
    title: 'BanaDB',
    icon: Layers,
    component: BanaDB,
    defaultWidth: 1200,
    defaultHeight: 700,
    minWidth: 900,
    minHeight: 550,
  },
};

export default APP_REGISTRY;
