import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, RefreshCw, Globe, Key, Shield, AlertTriangle } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';

export default function BanaApiKeys({ project }) {
  const [showAnon, setShowAnon] = useState(false);
  const [showService, setShowService] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['bana-api-keys', project.id],
    `${baseUrl}/api-keys`
  );

  const keys = data?.keys || [];
  const anonKey = keys.find((k) => k.role === 'anon' && k.is_active);
  const serviceKey = keys.find((k) => k.role === 'service' && k.is_active);

  const apiUrl = `${window.location.origin}/api/bana/v1/${project.slug}`;

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const handleRegenerate = async (role) => {
    const label = role === 'service' ? 'service_role' : 'anon';
    if (!confirm(`Regenerate the ${label} key? The current key will be revoked immediately and any apps using it will lose access.`)) return;

    setRegenerating(role);
    try {
      await api.post(`${baseUrl}/api-keys/regenerate`, { role });
      queryClient.invalidateQueries({ queryKey: ['bana-api-keys'] });
      toast.success(`${label} key regenerated`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to regenerate');
    } finally {
      setRegenerating(null);
    }
  };

  const maskKey = (key) => {
    if (!key) return '••••••••••••••••••••••••••••••••';
    return key.slice(0, key.indexOf('_', 5) + 1) + '••••••••••••••••••••••••••••';
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full overflow-auto p-4 space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          API Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Use these keys to connect your app to this BanaDB project via the REST API.
        </p>
      </div>

      {/* Project URL */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium">Project URL</h3>
        </div>
        <div className="flex items-center gap-2">
          <Input value={apiUrl} readOnly className="font-mono text-xs h-8" />
          <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copyText(apiUrl)}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground font-mono space-y-0.5 mt-1">
          <p>GET  /rest/TABLE_NAME — Read rows</p>
          <p>POST /rest/TABLE_NAME — Insert rows</p>
          <p>POST /auth/signup — Create user</p>
          <p>POST /auth/login — Authenticate</p>
        </div>
      </div>

      {/* Project API Keys */}
      <div className="space-y-4">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Project API Keys</h3>

        {/* Anon Key */}
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-sm font-medium">anon</span>
              <Badge variant="secondary" className="text-[10px]">public</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={regenerating === 'anon'}
              onClick={() => handleRegenerate('anon')}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${regenerating === 'anon' ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Safe to use in browsers and client-side apps. Provides read access to public data. Write operations require user authentication via Bearer token.
          </p>

          {anonKey?.api_key ? (
            <div className="flex items-center gap-2">
              <Input
                value={showAnon ? anonKey.api_key : maskKey(anonKey.api_key)}
                readOnly
                className="font-mono text-xs h-8"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowAnon(!showAnon)}
              >
                {showAnon ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => copyText(anonKey.api_key)}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={`bana_${anonKey?.key_prefix || ''}...`}
                readOnly
                className="font-mono text-xs h-8 text-muted-foreground"
              />
              <Badge variant="outline" className="text-[10px] shrink-0">legacy key</Badge>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 font-mono">
            <p className="text-muted-foreground/70 mb-0.5"># Read data (any key)</p>
            <p>curl -H "apikey: YOUR_ANON_KEY" \</p>
            <p>  {apiUrl}/rest/TABLE_NAME</p>
          </div>
        </div>

        {/* Service Role Key */}
        <div className="border rounded-lg p-4 space-y-3 border-amber-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-sm font-medium">service_role</span>
              <Badge variant="destructive" className="text-[10px]">secret</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={regenerating === 'service'}
              onClick={() => handleRegenerate('service')}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${regenerating === 'service' ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
          </div>

          <div className="flex items-start gap-2 text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded p-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              This key bypasses all authentication. Has full read/write/delete access and can execute raw SQL. <strong>Never expose in client-side code or browsers.</strong> Only use in backend servers.
            </span>
          </div>

          {serviceKey?.api_key ? (
            <div className="flex items-center gap-2">
              <Input
                value={showService ? serviceKey.api_key : maskKey(serviceKey.api_key)}
                readOnly
                className="font-mono text-xs h-8"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => setShowService(!showService)}
              >
                {showService ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => copyText(serviceKey.api_key)}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={`bana_svc_${serviceKey?.key_prefix || ''}...`}
                readOnly
                className="font-mono text-xs h-8 text-muted-foreground"
              />
              <Badge variant="outline" className="text-[10px] shrink-0">legacy key</Badge>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 font-mono">
            <p className="text-muted-foreground/70 mb-0.5"># Full access (bypasses auth)</p>
            <p>curl -H "apikey: YOUR_SERVICE_KEY" \</p>
            <p>  -X POST -d '{"{"}\"sql\":\"SELECT * FROM users\"{"}"}' \</p>
            <p>  {apiUrl}/sql</p>
          </div>
        </div>
      </div>

      {/* Permissions Table */}
      <div className="border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-medium">Role Permissions</h3>
        <div className="text-[10px]">
          <table className="w-full">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-1.5 font-medium">Operation</th>
                <th className="text-center py-1.5 font-medium">anon</th>
                <th className="text-center py-1.5 font-medium">service_role</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b border-border/50">
                <td className="py-1.5">GET /rest/* (read)</td>
                <td className="text-center text-green-500">Yes</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5">POST /rest/* (insert)</td>
                <td className="text-center text-amber-400">+ Bearer token</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5">PATCH /rest/* (update)</td>
                <td className="text-center text-amber-400">+ Bearer token</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5">DELETE /rest/* (delete)</td>
                <td className="text-center text-amber-400">+ Bearer token</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5">POST /auth/signup</td>
                <td className="text-center text-green-500">Yes</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5">POST /auth/login</td>
                <td className="text-center text-green-500">Yes</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
              <tr>
                <td className="py-1.5">POST /sql (execute)</td>
                <td className="text-center text-destructive">No</td>
                <td className="text-center text-green-500">Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
