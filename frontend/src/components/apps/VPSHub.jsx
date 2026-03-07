import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  GitMerge, Download, RotateCcw, Play, ChevronDown, ChevronRight,
  Database, Table2, Columns3, RefreshCw, Copy, Clock, User, ArrowDown,
  CheckCircle2, XCircle, AlertCircle, CircleDot,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

const STATUS_CONFIG = {
  applied:     { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', icon: CheckCircle2, label: 'Applied' },
  pending:     { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', icon: CircleDot, label: 'Pending' },
  rolled_back: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', icon: RotateCcw, label: 'Rolled Back' },
  failed:      { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: XCircle, label: 'Failed' },
};

export default function VPSHub() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('migrations');
  const [expandedMigration, setExpandedMigration] = useState(null);
  const [pulling, setPulling] = useState(false);
  const [rollingBack, setRollingBack] = useState(null);
  const queryClient = useQueryClient();

  // Load projects list
  const { data: projectsData, isLoading: loadingProjects } = useApiQuery(
    'bana-projects', '/admin/bana/projects'
  );
  const projects = projectsData?.projects || [];

  // Load migrations for selected project
  const { data: migrationsData, isLoading: loadingMigrations } = useApiQuery(
    ['sync-migrations', selectedProject?.id],
    `/admin/sync/projects/${selectedProject?.id}/migrations`,
    { enabled: !!selectedProject }
  );
  const migrations = migrationsData?.migrations || [];

  // Load pending changes
  const { data: changesData } = useApiQuery(
    ['sync-changes', selectedProject?.id],
    `/admin/sync/projects/${selectedProject?.id}/changes`,
    { enabled: !!selectedProject }
  );
  const changes = changesData?.changes || [];

  // Load schema
  const { data: schemaData, isLoading: loadingSchema } = useApiQuery(
    ['sync-schema', selectedProject?.id],
    `/admin/sync/projects/${selectedProject?.id}/schema`,
    { enabled: !!selectedProject && activeTab === 'schema' }
  );

  function refreshAll() {
    if (!selectedProject) return;
    queryClient.invalidateQueries({ queryKey: ['sync-migrations', selectedProject.id] });
    queryClient.invalidateQueries({ queryKey: ['sync-changes', selectedProject.id] });
    queryClient.invalidateQueries({ queryKey: ['sync-schema', selectedProject.id] });
  }

  async function handlePullChanges() {
    if (!selectedProject) return;
    setPulling(true);
    try {
      const { data } = await api.post(`/admin/sync/projects/${selectedProject.id}/migrations`);
      if (data.message === 'No pending changes') {
        toast.info('No pending changes to pull');
      } else {
        toast.success(`Migration v${data.version} created from ${changes.length} changes`);
      }
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Pull failed');
    } finally {
      setPulling(false);
    }
  }

  async function handlePush(migrationId) {
    try {
      await api.post(`/admin/sync/projects/${selectedProject.id}/migrations/${migrationId}/push`);
      toast.success('Migration applied successfully');
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Push failed');
    }
  }

  async function handleRollback(migrationId) {
    setRollingBack(migrationId);
    try {
      await api.post(`/admin/sync/projects/${selectedProject.id}/migrations/${migrationId}/rollback`);
      toast.success('Migration rolled back');
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      {/* Top Bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
        <GitMerge className="w-5 h-5 text-primary" />
        <span className="font-semibold text-lg">VPSHub</span>

        {/* Project Selector */}
        <div className="relative ml-4">
          <select
            className="bg-background border rounded-md px-3 py-1.5 text-sm pr-8 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
            value={selectedProject?.id || ''}
            onChange={e => {
              const p = projects.find(p => p.id === e.target.value);
              setSelectedProject(p || null);
              setExpandedMigration(null);
            }}
          >
            <option value="">Select a project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>

        {selectedProject && (
          <>
            <div className="flex items-center gap-2 ml-auto">
              {changes.length > 0 && (
                <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                  {changes.length} pending
                </Badge>
              )}
              <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                {migrations.length} migrations
              </Badge>
            </div>

            <Button size="sm" variant="outline" onClick={refreshAll}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              onClick={handlePullChanges}
              disabled={pulling || changes.length === 0}
            >
              <ArrowDown className="w-4 h-4 mr-1" />
              {pulling ? 'Pulling...' : 'Pull Changes'}
            </Button>
          </>
        )}
      </div>

      {/* Content */}
      {!selectedProject ? (
        <EmptyState loading={loadingProjects} projects={projects} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-44 border-r bg-card flex flex-col">
            <NavItem
              active={activeTab === 'migrations'}
              icon={GitMerge}
              label="Migrations"
              count={migrations.length}
              onClick={() => setActiveTab('migrations')}
            />
            <NavItem
              active={activeTab === 'schema'}
              icon={Table2}
              label="Schema"
              onClick={() => setActiveTab('schema')}
            />
            <NavItem
              active={activeTab === 'extension'}
              icon={Download}
              label="Extension"
              onClick={() => setActiveTab('extension')}
            />
          </div>

          {/* Main Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'migrations' && (
              <MigrationsTab
                migrations={migrations}
                changes={changes}
                loading={loadingMigrations}
                expandedMigration={expandedMigration}
                setExpandedMigration={setExpandedMigration}
                onPush={handlePush}
                onRollback={handleRollback}
                rollingBack={rollingBack}
              />
            )}
            {activeTab === 'schema' && (
              <SchemaTab schema={schemaData} loading={loadingSchema} />
            )}
            {activeTab === 'extension' && (
              <ExtensionTab project={selectedProject} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ active, icon: Icon, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2.5 text-sm w-full text-left transition-colors ${
        active
          ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{count}</span>
      )}
    </button>
  );
}

function EmptyState({ loading, projects }) {
  if (loading) return <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>;

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <GitMerge className="w-16 h-16 mb-4 opacity-30" />
      <p className="text-lg font-medium mb-1">VPSHub — Schema Management</p>
      <p className="text-sm">Select a BanaDB project to manage migrations</p>
      {projects.length === 0 && (
        <p className="text-xs mt-2">No projects found. Create one in BanaDB first.</p>
      )}
    </div>
  );
}

function MigrationsTab({ migrations, changes, loading, expandedMigration, setExpandedMigration, onPush, onRollback, rollingBack }) {
  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Pending Changes */}
      {changes.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
          <h3 className="text-sm font-medium text-amber-400 mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {changes.length} Pending Schema Changes
          </h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {changes.map(c => (
              <div key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <span className="text-amber-400">{c.event_type}</span>
                <span className="text-foreground">{c.object_type}</span>
                <span className="text-muted-foreground">{c.object_identity?.split('.').pop()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Migration Timeline */}
      <h3 className="text-sm font-medium text-muted-foreground">Migration Timeline</h3>
      {migrations.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No migrations yet. Pull changes to create the first one.</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[19px] top-6 bottom-6 w-px bg-border" />

          <div className="space-y-3">
            {migrations.map(m => {
              const config = STATUS_CONFIG[m.status] || STATUS_CONFIG.pending;
              const StatusIcon = config.icon;
              const isExpanded = expandedMigration === m.id;

              return (
                <div key={m.id} className="relative pl-10">
                  {/* Timeline dot */}
                  <div className="absolute left-2.5 top-3 w-4 h-4 rounded-full bg-background border-2 border-border flex items-center justify-center">
                    <div className={`w-2 h-2 rounded-full ${
                      m.status === 'applied' ? 'bg-emerald-400' :
                      m.status === 'failed' ? 'bg-red-400' :
                      m.status === 'rolled_back' ? 'bg-blue-400' : 'bg-amber-400'
                    }`} />
                  </div>

                  <div className="border rounded-lg bg-card overflow-hidden">
                    {/* Migration header */}
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors"
                      onClick={() => setExpandedMigration(isExpanded ? null : m.id)}
                    >
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      }
                      <Badge variant="outline" className="text-xs font-mono">v{m.version}</Badge>
                      <span className="text-sm font-medium flex-1 truncate">{m.name || `migration_v${m.version}`}</span>
                      <Badge variant="outline" className={`text-xs ${config.color}`}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {config.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(m.applied_at || m.created_at).toLocaleDateString()}
                      </span>
                      {m.applied_by && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {m.applied_by}
                        </span>
                      )}
                    </button>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">Source: {m.source}</Badge>
                          <Badge variant="outline" className="text-xs">
                            Checksum: {m.checksum?.substring(0, 12)}...
                          </Badge>
                        </div>

                        {/* SQL Up */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-muted-foreground">SQL (Up)</span>
                            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => copyToClipboard(m.sql_up)}>
                              <Copy className="w-3 h-3 mr-1" /> Copy
                            </Button>
                          </div>
                          <pre className="bg-background rounded border p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {m.sql_up}
                          </pre>
                        </div>

                        {/* SQL Down */}
                        {m.sql_down && (
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">SQL (Rollback)</span>
                            <pre className="bg-background rounded border p-3 text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap mt-1">
                              {m.sql_down}
                            </pre>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-2 border-t">
                          {m.status === 'pending' && (
                            <Button size="sm" onClick={() => onPush(m.id)}>
                              <Play className="w-3 h-3 mr-1" /> Apply Migration
                            </Button>
                          )}
                          {m.status === 'applied' && m.sql_down && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                              onClick={() => onRollback(m.id)}
                              disabled={rollingBack === m.id}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              {rollingBack === m.id ? 'Rolling back...' : 'Rollback'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaTab({ schema, loading }) {
  const [expandedTable, setExpandedTable] = useState(null);

  if (loading) return <LoadingSpinner />;
  if (!schema?.tables?.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Database className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No tables found in this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">
        Database Schema — {schema.tables.length} tables
      </h3>

      {schema.tables.map(table => {
        const isExpanded = expandedTable === table.name;
        return (
          <div key={table.name} className="border rounded-lg bg-card overflow-hidden">
            <button
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
              onClick={() => setExpandedTable(isExpanded ? null : table.name)}
            >
              {isExpanded
                ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                : <ChevronRight className="w-4 h-4 text-muted-foreground" />
              }
              <Table2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono font-medium">{table.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {table.columns.length} columns
              </span>
            </button>

            {isExpanded && (
              <div className="border-t">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Column</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Nullable</th>
                      <th className="text-left px-4 py-1.5 font-medium text-muted-foreground">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.columns.map(col => (
                      <tr key={col.column_name} className="border-t border-border/50 hover:bg-accent/30">
                        <td className="px-4 py-1.5 font-mono flex items-center gap-2">
                          <Columns3 className="w-3 h-3 text-muted-foreground" />
                          {col.column_name}
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground font-mono">
                          {col.data_type}{col.character_maximum_length ? `(${col.character_maximum_length})` : ''}
                        </td>
                        <td className="px-4 py-1.5">
                          <Badge variant="outline" className={`text-xs ${col.is_nullable === 'YES' ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}
                          </Badge>
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground font-mono text-xs truncate max-w-[200px]">
                          {col.column_default || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Constraints */}
                {table.constraints?.length > 0 && (
                  <div className="border-t p-3">
                    <span className="text-xs font-medium text-muted-foreground">Constraints</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {table.constraints.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {c.constraint_type}: {c.column_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Indexes */}
                {table.indexes?.length > 0 && (
                  <div className="border-t p-3">
                    <span className="text-xs font-medium text-muted-foreground">Indexes</span>
                    <div className="space-y-1 mt-1">
                      {table.indexes.map((idx, i) => (
                        <div key={i} className="text-xs font-mono text-muted-foreground truncate">
                          {idx.indexname}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExtensionTab({ project }) {
  return (
    <div className="max-w-2xl space-y-6">
      {/* Download Section */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <Download className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">VPC Sync — VS Code Extension</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Git-like schema sync directly in VS Code. Pull pending DB changes, push local migrations, and view history — all from the sidebar.
            </p>
            <div className="flex gap-2 mt-4">
              <a
                href="/downloads/vpc-sync.vsix"
                download
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download vpc-sync.vsix
              </a>
              <Badge variant="outline" className="self-center">v2.0.0</Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="border rounded-lg bg-card p-6 space-y-4">
        <h3 className="font-semibold">Setup Instructions</h3>

        <div className="space-y-3">
          <Step number={1} title="Install Extension">
            <p className="text-sm text-muted-foreground">
              Open VS Code → Extensions (Ctrl+Shift+X) → <code className="bg-muted px-1 rounded">...</code> menu → <strong>Install from VSIX</strong> → select the downloaded file.
            </p>
          </Step>

          <Step number={2} title="Configure Connection">
            <p className="text-sm text-muted-foreground mb-2">
              Open Command Palette (Ctrl+Shift+P) → <strong>VPC Sync: Configure Connection</strong>
            </p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20">Server URL:</span>
                <code className="bg-muted px-2 py-1 rounded text-xs flex-1 truncate">
                  {window.location.origin}/api/bana/v1/{project.slug}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => copyToClipboard(`${window.location.origin}/api/bana/v1/${project.slug}`)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-20">API Key:</span>
                <span className="text-xs text-muted-foreground italic">Use your project's Pull Key (found in BanaDB → Pull Keys)</span>
              </div>
            </div>
          </Step>

          <Step number={3} title="Start Syncing">
            <p className="text-sm text-muted-foreground">
              Click the VPC Sync icon in the Activity Bar (left sidebar). You'll see three panels:
            </p>
            <ul className="text-sm text-muted-foreground mt-1 space-y-1 ml-4 list-disc">
              <li><strong>Pending Changes</strong> — DDL changes detected in the database</li>
              <li><strong>Local Migrations</strong> — SQL files in your migrations folder</li>
              <li><strong>History</strong> — Applied/rolled-back migrations on the server</li>
            </ul>
          </Step>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border rounded-lg bg-card p-6">
        <h3 className="font-semibold mb-3">Quick Reference</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs">Pull</Badge>
            <span className="text-muted-foreground">Fetch DB changes → save as .sql</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs">Push</Badge>
            <span className="text-muted-foreground">Apply local .sql → execute on DB</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">Refresh</Badge>
            <span className="text-muted-foreground">Auto-refreshes every 30 seconds</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs">Rollback</Badge>
            <span className="text-muted-foreground">Revert applied migration</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
        {number}
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-medium mb-1">{title}</h4>
        {children}
      </div>
    </div>
  );
}
