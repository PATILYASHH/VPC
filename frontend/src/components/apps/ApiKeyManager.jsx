import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Copy, Eye } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import AgentApiKeys from '@/components/shared/AgentApiKeys';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { format } from 'date-fns';

// Permission scopes matching the admin route permission map
const PERM_OPTIONS = [
  { key: 'servers', label: 'Servers' },
  { key: 'databases', label: 'Databases' },
  { key: 'db', label: 'DB Projects' },
  { key: 'web_hosting', label: 'Web Hosting' },
  { key: 'vpshub', label: 'VPS Hub' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'ai_agent', label: 'AI Agent' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'logs', label: 'Logs' },
  { key: 'backups', label: 'Backups' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'users', label: 'Users' },
  { key: 'api_keys', label: 'API Keys' },
  { key: 'realtime', label: 'Realtime' },
  { key: 'settings', label: 'Settings' },
];

export default function ApiKeyManager() {
  const [section, setSection] = useState('admin');
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState(null);
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState({});
  const [creating, setCreating] = useState(false);
  const [viewKey, setViewKey] = useState(null);
  const [viewLogs, setViewLogs] = useState(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery('api-keys', '/admin/api-keys');

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      const { data: result } = await api.post('/admin/api-keys', { name, permissions });
      setNewKeyResult(result);
      setName('');
      setPermissions({});
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id, keyName) => {
    if (!confirm(`Revoke API key "${keyName}"? It stays in the list but stops working.`)) return;
    try {
      await api.delete(`/admin/api-keys/${id}`);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    } catch (err) {
      toast.error('Failed to revoke key');
    }
  };

  const handleDelete = async (id, keyName) => {
    if (!confirm(`Permanently delete API key "${keyName}" and its usage logs? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/api-keys/${id}/permanent`);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key deleted');
    } catch (err) {
      toast.error('Failed to delete key');
    }
  };

  const handleView = async (key) => {
    setViewKey(key);
    setViewLogs(null);
    try {
      const { data: usage } = await api.get(`/admin/api-keys/${key.id}/usage`);
      setViewLogs(usage.logs || []);
    } catch {
      setViewLogs([]);
    }
  };

  const copyKey = copyToClipboard;

  if (isLoading) return <LoadingSpinner />;

  // Section switcher: Admin REST keys vs AI/Claude agent keys
  const sectionTabs = (
    <div className="flex gap-1 p-1 rounded-lg bg-muted/40 w-fit">
      {[
        { id: 'admin', label: 'Admin Keys' },
        { id: 'agent', label: 'AI / Claude Keys' },
      ].map(t => (
        <button
          key={t.id}
          onClick={() => setSection(t.id)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            section === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (section === 'agent') {
    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b">{sectionTabs}</div>
        <div className="flex-1 overflow-auto p-4">
          <AgentApiKeys />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
        {sectionTabs}
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            API Keys ({data?.keys?.length || 0})
          </h2>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Create Key
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {data?.keys?.map((key) => (
          <div key={key.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{key.name}</h3>
                <Badge variant={key.is_active ? 'success' : 'destructive'} className="text-[10px]">
                  {key.is_active ? 'Active' : 'Revoked'}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-[11px] px-2" onClick={() => handleView(key)} title="View details & usage">
                  <Eye className="w-3.5 h-3.5 mr-1" />View
                </Button>
                {key.is_active && (
                  <Button variant="ghost" size="sm" className="h-7 text-[11px] px-2" onClick={() => handleRevoke(key.id, key.name)} title="Disable without deleting">
                    Revoke
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-[11px] px-2 text-destructive" onClick={() => handleDelete(key.id, key.name)} title="Delete permanently">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-muted-foreground/70">Prefix</span>
                <span className="font-mono">vpc_{key.key_prefix}...</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Requests</span>
                <span className="font-mono">{key.total_requests}</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Created</span>
                <span>{format(new Date(key.created_at), 'MMM d, yyyy')}</span>
              </div>
            </div>
            {key.permissions && Object.values(key.permissions).some(Boolean) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(key.permissions).filter(([, v]) => v).map(([k]) => (
                  <Badge key={k} variant="secondary" className="text-[10px]">
                    {PERM_OPTIONS.find(o => o.key === k)?.label || k}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tally Connector" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Permissions</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPermissions(Object.fromEntries(PERM_OPTIONS.map(o => [o.key, true])))}
                    className="text-[10px] text-primary hover:underline"
                  >Select all</button>
                  <button
                    type="button"
                    onClick={() => setPermissions({})}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto rounded-md border border-input p-2.5">
                {PERM_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permissions[opt.key] === true}
                      onChange={(e) => setPermissions(prev => ({ ...prev, [opt.key]: e.target.checked }))}
                      className="rounded border-border"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Tick the areas this key is allowed to access.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name || creating}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View key details + usage */}
      <Dialog open={!!viewKey} onOpenChange={() => setViewKey(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewKey?.name}</DialogTitle>
          </DialogHeader>
          {viewKey && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="block text-muted-foreground/70">Key</span>
                  <span className="font-mono">vpc_{viewKey.key_prefix}...</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/70">Status</span>
                  <Badge variant={viewKey.is_active ? 'success' : 'destructive'} className="text-[10px]">
                    {viewKey.is_active ? 'Active' : 'Revoked'}
                  </Badge>
                </div>
                <div>
                  <span className="block text-muted-foreground/70">Total Requests</span>
                  <span className="font-mono">{viewKey.total_requests}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/70">Rate Limit</span>
                  <span className="font-mono">{viewKey.rate_limit_per_minute}/min</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/70">Created</span>
                  <span>{format(new Date(viewKey.created_at), 'MMM d, yyyy HH:mm')}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground/70">Last Used</span>
                  <span>{viewKey.last_used_at ? format(new Date(viewKey.last_used_at), 'MMM d, yyyy HH:mm') : 'Never'}</span>
                </div>
              </div>

              {viewKey.permissions && Object.values(viewKey.permissions).some(Boolean) && (
                <div>
                  <span className="block text-xs text-muted-foreground/70 mb-1">Permissions</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(viewKey.permissions).filter(([, v]) => v).map(([k]) => (
                      <Badge key={k} variant="secondary" className="text-[10px]">
                        {PERM_OPTIONS.find(o => o.key === k)?.label || k}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="block text-xs text-muted-foreground/70 mb-1">Recent Usage</span>
                {viewLogs === null ? (
                  <p className="text-xs text-muted-foreground">Loading...</p>
                ) : viewLogs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No requests logged yet.</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-input divide-y divide-border">
                    {viewLogs.slice(0, 50).map(log => (
                      <div key={log.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
                        <span className={`font-mono font-semibold ${log.status_code < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {log.status_code}
                        </span>
                        <span className="font-mono text-muted-foreground">{log.method}</span>
                        <span className="font-mono truncate flex-1">{log.endpoint}</span>
                        <span className="text-muted-foreground/60 shrink-0">{format(new Date(log.created_at), 'MMM d HH:mm')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewKey(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show new key */}
      <Dialog open={!!newKeyResult} onOpenChange={() => setNewKeyResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-warning">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <Input value={newKeyResult?.api_key || ''} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copyKey(newKeyResult?.api_key)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKeyResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
