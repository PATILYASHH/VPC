import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CloudDownload, CheckCircle, XCircle, Loader2, Database, Users,
  AlertTriangle, RefreshCw, Unlink, Link2, ArrowDownToLine, Table2,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import api from '@/lib/api';
import { format } from 'date-fns';

export default function BanaSupabaseImport({ project }) {
  const [connectionString, setConnectionString] = useState('');
  const [importAuth, setImportAuth] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [operationResult, setOperationResult] = useState(null);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;

  // Fetch link status on mount
  const { data: linkStatus, isLoading: loadingStatus, refetch: refetchStatus } = useApiQuery(
    ['bana-import-status', project.id],
    `${baseUrl}/import/status`
  );

  const isLinked = linkStatus?.linked;

  const handleTestConnection = async () => {
    if (!connectionString.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post(`${baseUrl}/import/test-connection`, {
        connectionString: connectionString.trim(),
      });
      setTestResult(data);
      toast.success('Connection successful!');
    } catch (err) {
      setTestResult({ connected: false, error: err.response?.data?.error || err.message });
      toast.error('Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleImport = async () => {
    if (!connectionString.trim()) return;
    if (!confirm('This will import ALL data from Supabase into this BanaDB project. Existing tables will be replaced. Continue?')) return;

    setImporting(true);
    setOperationResult(null);
    try {
      const { data } = await api.post(`${baseUrl}/import/supabase`, {
        connectionString: connectionString.trim(),
        importAuth,
      });
      setOperationResult(data);
      if (data.status === 'completed') {
        toast.success(data.message);
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ['bana-'] });
      } else {
        toast.error(data.message || 'Import failed');
      }
    } catch (err) {
      setOperationResult({
        status: 'failed',
        message: err.response?.data?.error || err.message,
        steps: [],
      });
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleSync = async () => {
    if (!confirm('Sync all changes from Supabase? New tables, rows, and schema changes will be pulled in.')) return;
    setSyncing(true);
    setOperationResult(null);
    try {
      const { data } = await api.post(`${baseUrl}/import/sync`);
      setOperationResult(data);
      if (data.status === 'completed') {
        toast.success(data.message);
        refetchStatus();
        queryClient.invalidateQueries({ queryKey: ['bana-'] });
      } else {
        toast.error(data.message || 'Sync failed');
      }
    } catch (err) {
      setOperationResult({
        status: 'failed',
        message: err.response?.data?.error || err.message,
        steps: [],
      });
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect from Supabase? You will need to re-enter the connection string to sync again.')) return;
    try {
      await api.delete(`${baseUrl}/import/disconnect`);
      toast.success('Disconnected from Supabase');
      refetchStatus();
      setTestResult(null);
      setOperationResult(null);
    } catch (err) {
      toast.error('Failed to disconnect');
    }
  };

  const isBusy = importing || syncing;
  const progressValue = isBusy && operationResult?.steps?.length
    ? Math.round((operationResult.steps.filter((s) => s.status === 'done').length / 7) * 100)
    : isBusy ? 15 : 0;

  return (
    <div className="h-full overflow-auto p-4 space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CloudDownload className="w-4 h-4 text-primary" />
          Supabase Import & Sync
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Import your entire Supabase database into BanaDB and keep it synced with ongoing changes.
        </p>
      </div>

      {/* Linked Status Banner */}
      {isLinked && (
        <div className="border rounded-lg p-4 border-green-500/30 bg-green-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-500">Connected to Supabase</span>
            </div>
            <Badge variant="outline" className="text-[10px]">
              {linkStatus.sync_status || 'linked'}
            </Badge>
          </div>

          {linkStatus.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Last synced: {format(new Date(linkStatus.last_sync_at), 'MMM d, yyyy HH:mm')}
            </p>
          )}

          {/* Remote info */}
          {linkStatus.remote && (
            <div className="grid grid-cols-3 gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Size:</span>
                <span className="font-medium">{linkStatus.remote.database_size}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Tables:</span>
                <span className="font-medium">{linkStatus.remote.table_count}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Auth:</span>
                <span className="font-medium">{linkStatus.remote.auth_user_count}</span>
              </div>
            </div>
          )}

          {/* Remote table list */}
          {linkStatus.remote?.tables?.length > 0 && (
            <div className="pt-2 border-t">
              <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">Remote Tables</p>
              <div className="flex flex-wrap gap-1.5">
                {linkStatus.remote.tables.map((t) => (
                  <Badge key={t.name} variant="secondary" className="text-[10px] font-mono">
                    {t.name} <span className="text-muted-foreground ml-1">({t.rows})</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Sync & Disconnect actions */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSync} disabled={isBusy} className="flex-1">
              {syncing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Syncing...</>
              ) : (
                <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Sync Now</>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={isBusy}>
              <Unlink className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {/* Connection String (show when not linked) */}
      {!isLinked && (
        <>
          <div className="border rounded-lg p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Supabase Connection String</Label>
              <Input
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                placeholder="postgresql://postgres.xxxx:password@aws-0-region.pooler.supabase.com:5432/postgres"
                className="font-mono text-xs"
                type="password"
              />
              <p className="text-[10px] text-muted-foreground">
                Find this in Supabase Dashboard → Settings → Database → Connection String → URI.
                Use the <strong>direct connection</strong> (not pooler) to access auth.users.
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !connectionString.trim()}
            >
              {testing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Testing...</>
              ) : (
                'Test Connection'
              )}
            </Button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`border rounded-lg p-4 ${testResult.connected ? 'border-green-500/30 bg-green-500/5' : 'border-destructive/30 bg-destructive/5'}`}>
              <div className="flex items-center gap-2 mb-2">
                {testResult.connected ? (
                  <><CheckCircle className="w-4 h-4 text-green-500" /><span className="text-sm font-medium text-green-500">Connected</span></>
                ) : (
                  <><XCircle className="w-4 h-4 text-destructive" /><span className="text-sm font-medium text-destructive">Failed: {testResult.error}</span></>
                )}
              </div>

              {testResult.connected && (
                <>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div className="flex items-center gap-2 text-xs">
                      <Database className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Size:</span>
                      <span className="font-medium">{testResult.database_size}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Tables:</span>
                      <span className="font-medium">{testResult.table_count}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Auth Users:</span>
                      <span className="font-medium">{testResult.auth_user_count}</span>
                    </div>
                  </div>

                  {/* Table list */}
                  {testResult.tables?.length > 0 && (
                    <div className="mt-3 pt-2 border-t">
                      <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">Tables to Import</p>
                      <div className="flex flex-wrap gap-1.5">
                        {testResult.tables.map((t) => (
                          <Badge key={t.name} variant="secondary" className="text-[10px] font-mono">
                            {t.name} <span className="text-muted-foreground ml-1">({t.rows})</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Import Options */}
          {testResult?.connected && (
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="text-xs font-medium">Import Options</h3>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked disabled className="rounded" />
                <span>Schema & Data</span>
                <span className="text-muted-foreground">(all tables, indexes, foreign keys, sequences, enums)</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={importAuth}
                  onChange={(e) => setImportAuth(e.target.checked)}
                  className="rounded"
                />
                <span>Auth Users</span>
                <span className="text-muted-foreground">
                  ({testResult.auth_user_count} users — passwords preserved for login compatibility)
                </span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked disabled className="rounded" />
                <span>Link for Sync</span>
                <span className="text-muted-foreground">(save connection to pull future changes)</span>
              </label>

              <div className="pt-2">
                <Button onClick={handleImport} disabled={isBusy} className="w-full">
                  {importing ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing All Data...</>
                  ) : (
                    <><ArrowDownToLine className="w-4 h-4 mr-2" />Import Everything from Supabase</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Progress / Running */}
      {isBusy && (
        <div className="border rounded-lg p-4 space-y-3 border-primary/30">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium">{syncing ? 'Syncing...' : 'Importing...'}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Transferring data directly via SQL. This may take several minutes for large databases.
          </p>
          <Progress value={progressValue} className="h-1.5" />
        </div>
      )}

      {/* Operation Results */}
      {operationResult && !isBusy && (
        <div className={`border rounded-lg p-4 space-y-3 ${
          operationResult.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
          operationResult.status === 'failed' ? 'border-destructive/30 bg-destructive/5' : ''
        }`}>
          <div className="flex items-center gap-2">
            {operationResult.status === 'completed' ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : operationResult.status === 'failed' ? (
              <XCircle className="w-4 h-4 text-destructive" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className="text-sm font-medium">{operationResult.message}</span>
          </div>

          {/* Steps */}
          {operationResult.steps?.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {operationResult.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {step.status === 'done' ? (
                    <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                  ) : step.status === 'failed' ? (
                    <XCircle className="w-3 h-3 text-destructive shrink-0" />
                  ) : step.status === 'warning' ? (
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                  )}
                  <span className="text-muted-foreground">{step.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {operationResult.status === 'completed' && (
            <div className="grid grid-cols-4 gap-3 mt-2 pt-2 border-t">
              <div className="text-xs">
                <span className="block text-muted-foreground">Tables</span>
                <span className="font-medium text-lg">{operationResult.tables_imported ?? operationResult.new_tables ?? 0}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Rows</span>
                <span className="font-medium text-lg">{(operationResult.rows_imported ?? operationResult.rows_synced ?? 0).toLocaleString()}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Auth Users</span>
                <span className="font-medium text-lg">{operationResult.auth_users_imported ?? operationResult.auth_users_synced ?? 0}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Duration</span>
                <span className="font-medium text-lg">{((operationResult.duration_ms || 0) / 1000).toFixed(1)}s</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="border rounded-lg p-3 bg-muted/30">
        <h3 className="text-xs font-medium mb-1">How it works</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>Connects directly to your Supabase PostgreSQL database</li>
          <li>Copies <strong>all tables</strong> with full data (batch transfer via SQL)</li>
          <li>Preserves primary keys, foreign keys, indexes, constraints, sequences, and enums</li>
          <li>Migrates auth users with password hashes (login compatibility preserved)</li>
          <li>Saves the connection for <strong>ongoing sync</strong> — pull new changes anytime</li>
        </ul>
        <h3 className="text-xs font-medium mt-2 mb-1">What syncing does</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>Detects new tables added in Supabase and creates them in BanaDB</li>
          <li>Detects new columns and adds them to existing tables</li>
          <li>Upserts all rows — new rows are added, changed rows are updated</li>
          <li>Removes rows deleted in Supabase (full consistency)</li>
          <li>Syncs new auth users and updated passwords</li>
        </ul>
        <h3 className="text-xs font-medium mt-2 mb-1">Not imported</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>Supabase system schemas (auth, storage, realtime, edge functions)</li>
          <li>Row Level Security policies</li>
          <li>Storage bucket files</li>
        </ul>
      </div>
    </div>
  );
}
