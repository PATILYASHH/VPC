import { Server, Database, Key, Activity, HardDrive, FileText, Terminal, Layers, Shield, FolderOpen, GitMerge, Globe } from 'lucide-react';
import ServerManager from '@/components/apps/ServerManager';
import DatabaseManager from '@/components/apps/DatabaseManager';
import ApiKeyManager from '@/components/apps/ApiKeyManager';
import IntegrationMonitor from '@/components/apps/IntegrationMonitor';
import BackupManager from '@/components/apps/BackupManager';
import LogsViewer from '@/components/apps/LogsViewer';
import DeveloperTerminal from '@/components/apps/DeveloperTerminal';
import BanaDB from '@/components/apps/BanaDB';
import VpcAuth from '@/components/apps/VpcAuth';
import Gallery from '@/components/apps/Gallery';
import WebHosting from '@/components/apps/WebHosting';
import VPSHub from '@/components/apps/VPSHub';

const APP_REGISTRY = {
  'server-manager': {
    id: 'server-manager',
    title: 'Server Manager',
    icon: Server,
    component: ServerManager,
    permission: 'servers',
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
    permission: 'databases',
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
    permission: 'api_keys',
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
    permission: 'integrations',
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
    permission: 'backups',
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
    permission: 'logs',
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
    permission: 'terminal',
    defaultWidth: 800,
    defaultHeight: 500,
    minWidth: 500,
    minHeight: 300,
  },
  'bana-db': {
    id: 'bana-db',
    title: 'DB',
    icon: Layers,
    component: BanaDB,
    permission: 'banadb',
    defaultWidth: 1200,
    defaultHeight: 700,
    minWidth: 900,
    minHeight: 550,
  },
  'vpc-auth': {
    id: 'vpc-auth',
    title: 'VPC Auth',
    icon: Shield,
    component: VpcAuth,
    permission: 'users',
    defaultWidth: 900,
    defaultHeight: 600,
    minWidth: 600,
    minHeight: 400,
  },
  'gallery': {
    id: 'gallery',
    title: 'Gallery',
    icon: FolderOpen,
    component: Gallery,
    permission: 'gallery',
    defaultWidth: 1100,
    defaultHeight: 700,
    minWidth: 800,
    minHeight: 500,
  },
  'web-hosting': {
    id: 'web-hosting',
    title: 'Web Hosting',
    icon: Globe,
    component: WebHosting,
    permission: 'web_hosting',
    defaultWidth: 1100,
    defaultHeight: 700,
    minWidth: 800,
    minHeight: 500,
  },
  'vpshub': {
    id: 'vpshub',
    title: 'VPSHub',
    icon: GitMerge,
    component: VPSHub,
    defaultWidth: 1100,
    defaultHeight: 700,
    minWidth: 800,
    minHeight: 500,
  },
};

export default APP_REGISTRY;
