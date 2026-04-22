// Widget registry — small composable building blocks that can be embedded
// inside any app or pinned to the Dashboard app.
//
// To add a widget: createWidget({ id, title, render, defaultSize }).

import SystemMetricsWidget from '@/components/widgets/SystemMetricsWidget';
import JobQueueWidget from '@/components/widgets/JobQueueWidget';
import RecentContextWidget from '@/components/widgets/RecentContextWidget';
import NotificationsWidget from '@/components/widgets/NotificationsWidget';
import QuickAppsWidget from '@/components/widgets/QuickAppsWidget';
import ConnectionsWidget from '@/components/widgets/ConnectionsWidget';
import SystemHealthWidget from '@/components/widgets/SystemHealthWidget';

const WIDGET_REGISTRY = {
  'system-metrics': {
    id: 'system-metrics',
    title: 'System Metrics',
    description: 'CPU, memory, disk in real time',
    render: SystemMetricsWidget,
    defaultSize: { w: 2, h: 1 },
  },
  'job-queue': {
    id: 'job-queue',
    title: 'Active Jobs',
    description: 'Running deploys, backups, tasks',
    render: JobQueueWidget,
    defaultSize: { w: 2, h: 2 },
  },
  'recent-context': {
    id: 'recent-context',
    title: 'Recent',
    description: 'Recent repos, databases, projects',
    render: RecentContextWidget,
    defaultSize: { w: 1, h: 2 },
  },
  'notifications': {
    id: 'notifications',
    title: 'Notifications',
    description: 'Latest activity feed',
    render: NotificationsWidget,
    defaultSize: { w: 2, h: 2 },
  },
  'quick-apps': {
    id: 'quick-apps',
    title: 'Quick Launch',
    description: 'Launch any app',
    render: QuickAppsWidget,
    defaultSize: { w: 2, h: 1 },
  },
  'connections': {
    id: 'connections',
    title: 'Connections',
    description: 'Saved third-party services',
    render: ConnectionsWidget,
    defaultSize: { w: 2, h: 2 },
  },
  'system-health': {
    id: 'system-health',
    title: 'System Health',
    description: 'Error & warning counts (last 24h)',
    render: SystemHealthWidget,
    defaultSize: { w: 2, h: 2 },
  },
};

export default WIDGET_REGISTRY;
