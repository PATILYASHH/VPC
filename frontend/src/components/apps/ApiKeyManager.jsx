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
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { format } from 'date-fns';

export default function ApiKeyManager() {
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState(null);
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState('{}');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useApiQuery('api-keys', '/admin/api-keys');

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      let perms = {};
      try { perms = JSON.parse(permissions); } catch { perms = {}; }

      const { data: result } = await api.post('/admin/api-keys', { name, permissions: perms });
      setNewKeyResult(result);
      setName('');
      setPermissions('{}');
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id, keyName) => {
    if (!confirm(`Revoke API key "${keyName}"?`)) return;
    try {
      await api.delete(`/admin/api-keys/${id}`);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    } catch (err) {
      toast.error('Failed to revoke key');
    }
  };

  const copyKey = copyToClipboard;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          API Keys ({data?.keys?.length || 0})
        </h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Create Key
        </Button>
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
              {key.is_active && (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRevoke(key.id, key.name)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
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
            {key.permissions && Object.keys(key.permissions).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(key.permissions).map(([k, v]) => (
                  <Badge key={k} variant={v ? 'secondary' : 'outline'} className="text-[10px]">
                    {k}: {v ? 'yes' : 'no'}
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
            <div className="space-y-1">
              <Label className="text-xs">Permissions (JSON)</Label>
              <textarea
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono h-24"
                value={permissions}
                onChange={(e) => setPermissions(e.target.value)}
                placeholder='{"read_inventory": true, "create_invoice": true}'
              />
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
