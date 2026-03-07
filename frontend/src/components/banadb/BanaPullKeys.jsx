import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Copy, Eye, EyeOff, RefreshCw, Download, Key, AlertTriangle,
  Code2, Check, Power, PowerOff, Activity, Terminal, Globe,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

export default function BanaPullKeys({ project }) {
  const [showPullKey, setShowPullKey] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [enablingTracking, setEnablingTracking] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const apiUrl = `${window.location.origin}/api/bana/v1/${project.slug}`;

  const { data: keysData, isLoading: keysLoading } = useApiQuery(
    ['bana-api-keys', project.id],
    `${baseUrl}/api-keys`
  );

  const { data: pullStatus, isLoading: statusLoading } = useApiQuery(
    ['bana-pull-status', project.id],
    `${baseUrl}/pull/status`
  );

  const keys = keysData?.keys || [];
  const pullKey = keys.find((k) => k.role === 'pull' && k.is_active);
  const trackingEnabled = pullStatus?.enabled || false;
  const totalChanges = pullStatus?.total_changes || 0;

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const maskKey = (key) => {
    if (!key) return '••••••••••••••••••••••••••••••••••••••••';
    const prefixEnd = key.indexOf('_', 10) + 1;
    return key.slice(0, prefixEnd) + key.slice(prefixEnd, prefixEnd + 4) + '••••••••••••••••••••••••••••';
  };

  const handleToggleTracking = async () => {
    const action = trackingEnabled ? 'disable' : 'enable';
    if (trackingEnabled && !confirm('Disable pull tracking? Event triggers will be removed and future schema changes will not be tracked.')) return;
    setEnablingTracking(true);
    try {
      await api.post(`${baseUrl}/pull/${action}`);
      queryClient.invalidateQueries({ queryKey: ['bana-pull-status'] });
      toast.success(`Pull tracking ${action}d`);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${action} tracking`);
    } finally {
      setEnablingTracking(false);
    }
  };

  const handleRegenerate = async () => {
    if (!confirm('Regenerate pull key? The current key will stop working immediately.')) return;
    setRegenerating(true);
    try {
      await api.post(`${baseUrl}/api-keys/regenerate`, { role: 'pull' });
      queryClient.invalidateQueries({ queryKey: ['bana-api-keys'] });
      toast.success('Pull key regenerated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to regenerate');
    } finally {
      setRegenerating(false);
    }
  };

  if (keysLoading || statusLoading) return <LoadingSpinner />;

  const pullKeyStr = pullKey?.api_key || 'YOUR_PULL_KEY';

  return (
    <div className="h-full overflow-auto p-4 space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold">Pull Keys</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pull incremental SQL schema changes from your database to your local codebase.
        </p>
      </div>

      {/* ── Pull Tracking Status ───────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-xs font-medium">DDL Change Tracking</h3>
            <Badge
              variant={trackingEnabled ? 'default' : 'secondary'}
              className="text-[9px]"
            >
              {trackingEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
          <Button
            size="sm"
            variant={trackingEnabled ? 'destructive' : 'default'}
            className="h-7 text-[11px]"
            onClick={handleToggleTracking}
            disabled={enablingTracking}
          >
            {enablingTracking ? (
              <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            ) : trackingEnabled ? (
              <PowerOff className="w-3 h-3 mr-1" />
            ) : (
              <Power className="w-3 h-3 mr-1" />
            )}
            {trackingEnabled ? 'Disable' : 'Enable'} Tracking
          </Button>
        </div>

        {trackingEnabled && (
          <div className="text-[10px] text-muted-foreground space-y-1 bg-muted/30 rounded p-2.5">
            <p>PostgreSQL event triggers are capturing all DDL changes (CREATE, ALTER, DROP).</p>
            <p>Total tracked changes: <span className="font-mono text-foreground">{totalChanges}</span></p>
            {pullStatus?.installed_at && (
              <p>Installed: <span className="font-mono text-foreground">{new Date(pullStatus.installed_at).toLocaleString()}</span></p>
            )}
          </div>
        )}

        {!trackingEnabled && (
          <p className="text-[10px] text-muted-foreground">
            Enable tracking to start capturing schema changes. Once enabled, all CREATE TABLE,
            ALTER TABLE, DROP, and other DDL statements will be recorded for pulling.
          </p>
        )}
      </div>

      {/* ── Pull Key ───────────────────────────────────────── */}
      <div className="border rounded-lg divide-y">
        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium ml-1.5">Project URL</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Input value={apiUrl} readOnly className="font-mono text-[11px] h-7 bg-muted/30" />
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyText(apiUrl)}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-medium ml-1.5">pull key</span>
              <Badge variant="secondary" className="text-[9px] ml-1.5">read-only</Badge>
            </div>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              <RefreshCw className={`w-2.5 h-2.5 ${regenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={pullKey && !pullKey.api_key
                ? `${maskKey(null)}... (regenerate to reveal)`
                : showPullKey ? pullKeyStr : maskKey(pullKey?.api_key)
              }
              readOnly
              className="font-mono text-[11px] h-7 bg-muted/30"
            />
            {pullKey?.api_key && (
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setShowPullKey(!showPullKey)}>
                {showPullKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyText(pullKeyStr)}>
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2 text-[10px] text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          The <strong>pull key</strong> is read-only — it can only fetch schema changes and acknowledge pulls.
          It cannot read data, write data, or execute arbitrary SQL.
        </span>
      </div>

      {/* ── CLI Usage ──────────────────────────────────────── */}
      <div className="border rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b">
          <Terminal className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-medium">CLI Usage</h3>
        </div>
        <div className="p-3 space-y-4">
          <CodeBlock title="Install" copyFn={copyText} code={`npm install -g vpc-pull`} />
          <CodeBlock title="Configure" copyFn={copyText} code={`vpc-pull init \\
  --url ${apiUrl} \\
  --key ${pullKeyStr.slice(0, 24)}...`} />
          <CodeBlock title="Pull changes" copyFn={copyText} code={`# Pull new schema changes to local migrations folder
vpc-pull pull --out ./migrations

# Preview changes without writing files
vpc-pull pull --dry-run`} />
          <CodeBlock title="Check status" copyFn={copyText} code={`vpc-pull status`} />
        </div>
      </div>

      {/* ── VS Code Extension ─────────────────────────────── */}
      <div className="border rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b">
          <Code2 className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-medium">VS Code Extension</h3>
        </div>
        <div className="p-3 space-y-3">
          <p className="text-[10px] text-muted-foreground">
            Install the VPC Pull extension for VS Code to pull schema changes directly from your editor.
          </p>
          <CodeBlock title="Commands" copyFn={copyText} code={`Ctrl+Shift+P → "VPC Pull: Configure Connection"
Ctrl+Shift+P → "VPC Pull: Pull Schema Changes"
Ctrl+Shift+P → "VPC Pull: Select Output Folder"
Ctrl+Shift+P → "VPC Pull: Show Status"`} />
          <p className="text-[10px] text-muted-foreground">
            The status bar shows pending change count and updates every 60 seconds.
            Click it to pull immediately.
          </p>
        </div>
      </div>

      {/* ── Permissions ────────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium">Pull Key Permissions</h3>
        <div className="text-[10px]">
          <table className="w-full">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Endpoint</th>
                <th className="text-center py-1.5 font-medium w-24">pull</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {[
                ['GET /pull/status', true],
                ['GET /pull/changes', true],
                ['GET /pull/migration', true],
                ['POST /pull/ack', true],
                ['GET /rest/*', false],
                ['POST /rest/*', false],
                ['POST /sql', false],
                ['POST /auth/*', false],
              ].map(([endpoint, allowed], i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 font-mono">{endpoint}</td>
                  <td className="text-center">
                    {allowed ? (
                      <Check className="w-3 h-3 text-green-500 mx-auto" />
                    ) : (
                      <span className="text-destructive">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ title, code, copyFn }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground mb-1">{title}</p>
      <div className="relative group">
        <pre className="text-[10px] bg-muted/40 rounded p-2.5 overflow-x-auto font-mono leading-relaxed whitespace-pre text-muted-foreground">{code}</pre>
        <button
          className="absolute top-1.5 right-1.5 p-1 rounded bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => copyFn(code)}
        >
          <Copy className="w-2.5 h-2.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
