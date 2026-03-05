import { useState, useEffect, useRef } from 'react';
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
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const pollRef = useRef(null);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;

  // Fetch link status on mount
  const { data: linkStatus, isLoading: loadingStatus, refetch: refetchStatus } = useApiQuery(
    ['bana-import-status', project.id],
    `${baseUrl}/import/status`
  );

  const isLinked = linkStatus?.linked;

  // Poll for job status when jobId is set
  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const { data } = await api.get(`${baseUrl}/import/job/${jobId}`);
        setJobStatus(data);

        if (data.status !== 'running') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setJobId(null);

          if (data.status === 'completed') {
            toast.success(data.message);
            refetchStatus();
            queryClient.invalidateQueries({ queryKey: ['bana-'] });
          } else {
            toast.error(data.message || 'Operation failed');
          }
        }
      } catch {
        // Polling error — keep trying
      }
    };

    // Poll immediately, then every 2s
    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId]);

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

    setJobStatus(null);
    try {
      const { data } = await api.post(`${baseUrl}/import/supabase`, {
        connectionString: connectionString.trim(),
        importAuth,
      });
      setJobId(data.jobId);
      setJobStatus({ status: 'running', progress: 5, steps: [], message: 'Starting import...' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start import');
    }
  };

  const handleSync = async () => {
    if (!confirm('Sync all data from Supabase? This re-imports everything to ensure full consistency.')) return;

    setJobStatus(null);
    try {
      const { data } = await api.post(`${baseUrl}/import/sync`);
      setJobId(data.jobId);
      setJobStatus({ status: 'running', progress: 5, steps: [], message: 'Starting sync...' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start sync');
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect from Supabase? You will need to re-enter the connection string to sync again.')) return;
    try {
      await api.delete(`${baseUrl}/import/disconnect`);
      toast.success('Disconnected from Supabase');
      refetchStatus();
      setTestResult(null);
      setJobStatus(null);
    } catch (err) {
      toast.error('Failed to disconnect');
    }
  };

  const isBusy = !!jobId || jobStatus?.status === 'running';

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
      {isLinked && !isBusy && (
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
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Sync Now
            </Button>
            <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={isBusy}>
              <Unlink className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {/* Connection String (show when not linked and not busy) */}
      {!isLinked && !isBusy && (
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
                <span className="text-muted-foreground">(all tables, indexes, foreign keys, sequences, enums, views)</span>
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
                  <ArrowDownToLine className="w-4 h-4 mr-2" />
                  Import Everything from Supabase
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Progress / Running */}
      {(isBusy || jobStatus?.status === 'running') && (
        <div className="border rounded-lg p-4 space-y-3 border-primary/30">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium">{jobStatus?.message || 'Working...'}</span>
          </div>
          <Progress value={jobStatus?.progress || 5} className="h-1.5" />

          {/* Show completed steps */}
          {jobStatus?.steps?.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {jobStatus.steps.map((step, i) => (
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

          <p className="text-[10px] text-muted-foreground">
            Using PostgreSQL native dump/restore for maximum reliability. This runs in the background — you can navigate away and come back.
          </p>
        </div>
      )}

      {/* Operation Results (shown after completion) */}
      {jobStatus && !isBusy && jobStatus.status !== 'running' && (
        <div className={`border rounded-lg p-4 space-y-3 ${
          jobStatus.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
          jobStatus.status === 'failed' ? 'border-destructive/30 bg-destructive/5' : ''
        }`}>
          <div className="flex items-center gap-2">
            {jobStatus.status === 'completed' ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-destructive" />
            )}
            <span className="text-sm font-medium">{jobStatus.message}</span>
          </div>

          {/* Steps */}
          {jobStatus.steps?.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {jobStatus.steps.map((step, i) => (
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
          {jobStatus.status === 'completed' && (
            <div className="grid grid-cols-4 gap-3 mt-2 pt-2 border-t">
              <div className="text-xs">
                <span className="block text-muted-foreground">Tables</span>
                <span className="font-medium text-lg">{jobStatus.tables_imported || 0}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Rows</span>
                <span className="font-medium text-lg">{(jobStatus.rows_imported || 0).toLocaleString()}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Auth Users</span>
                <span className="font-medium text-lg">{jobStatus.auth_users_imported || 0}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Duration</span>
                <span className="font-medium text-lg">{((jobStatus.duration_ms || 0) / 1000).toFixed(1)}s</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="border rounded-lg p-3 bg-muted/30">
        <h3 className="text-xs font-medium mb-1">How it works</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>Uses PostgreSQL native <strong>pg_dump/pg_restore</strong> for maximum reliability</li>
          <li>Copies <strong>all tables</strong> with full data, views, functions, triggers, and extensions</li>
          <li>Preserves primary keys, foreign keys, indexes, constraints, sequences, and enums</li>
          <li>Migrates auth users with password hashes (login compatibility preserved)</li>
          <li>Saves the connection for <strong>ongoing sync</strong> — pull new changes anytime</li>
          <li>Runs in the background — no timeout limits, handles databases of any size</li>
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
