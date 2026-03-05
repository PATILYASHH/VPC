import { useState } from 'react';
import { toast } from 'sonner';
import { CloudDownload, CheckCircle, XCircle, Loader2, Database, Users, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import api from '@/lib/api';

const STEP_LABELS = {
  dump: 'Dumping remote database',
  restore: 'Restoring into BanaDB',
  auth: 'Migrating auth users',
  error: 'Error',
};

export default function BanaSupabaseImport({ project }) {
  const [connectionString, setConnectionString] = useState('');
  const [importAuth, setImportAuth] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const baseUrl = `/admin/bana/projects/${project.id}`;

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
    if (!confirm('This will import all data from Supabase into this BanaDB project. Existing data may be overwritten. Continue?')) return;

    setImporting(true);
    setImportResult(null);

    try {
      const { data } = await api.post(`${baseUrl}/import/supabase`, {
        connectionString: connectionString.trim(),
        importAuth,
      });
      setImportResult(data);
      if (data.status === 'completed') {
        toast.success(data.message);
      } else {
        toast.error(data.message || 'Import failed');
      }
    } catch (err) {
      setImportResult({
        status: 'failed',
        message: err.response?.data?.error || err.message,
        steps: [],
      });
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CloudDownload className="w-4 h-4 text-primary" />
          Import from Supabase
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Import your entire Supabase database into this BanaDB project — tables, data, foreign keys, indexes, and auth users.
        </p>
      </div>

      {/* Connection String */}
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
            Find this in Supabase Dashboard → Settings → Database → Connection String → URI
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
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="flex items-center gap-2 text-xs">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Size:</span>
                <span className="font-medium">{testResult.database_size}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Tables:</span>
                <span className="font-medium">{testResult.table_count}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Users className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Auth Users:</span>
                <span className="font-medium">{testResult.auth_user_count}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Schemas:</span>
                <div className="flex gap-1 flex-wrap">
                  {testResult.schemas?.slice(0, 5).map((s) => (
                    <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                  ))}
                </div>
              </div>
            </div>
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
            <span className="text-muted-foreground">(tables, indexes, foreign keys, sequences)</span>
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
              ({testResult.auth_user_count} users from Supabase auth.users)
            </span>
          </label>

          <div className="pt-2">
            <Button
              onClick={handleImport}
              disabled={importing}
              className="w-full"
            >
              {importing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing...</>
              ) : (
                <><CloudDownload className="w-4 h-4 mr-2" />Start Import</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Import Progress / Results */}
      {importing && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-sm font-medium">Importing...</span>
          </div>
          <p className="text-xs text-muted-foreground">
            This may take a few minutes depending on database size. Do not close this window.
          </p>
          <Progress value={33} className="h-1.5" />
        </div>
      )}

      {importResult && (
        <div className={`border rounded-lg p-4 space-y-3 ${
          importResult.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
          importResult.status === 'failed' ? 'border-destructive/30 bg-destructive/5' : ''
        }`}>
          <div className="flex items-center gap-2">
            {importResult.status === 'completed' ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : importResult.status === 'failed' ? (
              <XCircle className="w-4 h-4 text-destructive" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-500" />
            )}
            <span className="text-sm font-medium">{importResult.message}</span>
          </div>

          {/* Steps */}
          {importResult.steps?.length > 0 && (
            <div className="space-y-1.5 mt-2">
              {importResult.steps.map((step, i) => (
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
          {importResult.status === 'completed' && (
            <div className="grid grid-cols-3 gap-3 mt-2 pt-2 border-t">
              <div className="text-xs">
                <span className="block text-muted-foreground">Tables</span>
                <span className="font-medium text-lg">{importResult.tables_imported}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Auth Users</span>
                <span className="font-medium text-lg">{importResult.auth_users_imported}</span>
              </div>
              <div className="text-xs">
                <span className="block text-muted-foreground">Duration</span>
                <span className="font-medium text-lg">{(importResult.duration_ms / 1000).toFixed(1)}s</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="border rounded-lg p-3 bg-muted/30">
        <h3 className="text-xs font-medium mb-1">What gets imported?</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>All tables in the <code>public</code> schema with data</li>
          <li>Primary keys, foreign keys, indexes, and constraints</li>
          <li>Sequences and default values</li>
          <li>Custom types and enums</li>
          <li>Auth users (email + password hashes, preserving login compatibility)</li>
        </ul>
        <h3 className="text-xs font-medium mt-2 mb-1">What is NOT imported?</h3>
        <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
          <li>Supabase system schemas (auth, storage, realtime, etc.)</li>
          <li>Row Level Security (RLS) policies</li>
          <li>Supabase Edge Functions</li>
          <li>Storage bucket files</li>
        </ul>
      </div>
    </div>
  );
}
