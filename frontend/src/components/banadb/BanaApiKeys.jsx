import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Copy } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';

export default function BanaApiKeys({ project }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('anon');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['bana-api-keys', project.id],
    `${baseUrl}/api-keys`
  );

  const handleCreate = async () => {
    if (!name) return;
    setCreating(true);
    try {
      const { data: result } = await api.post(`${baseUrl}/api-keys`, { name, role });
      setNewKeyResult(result);
      setName('');
      setRole('anon');
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ['bana-api-keys'] });
      toast.success('API key created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create key');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (keyId, keyName) => {
    if (!confirm(`Revoke API key "${keyName}"?`)) return;
    try {
      await api.delete(`${baseUrl}/api-keys/${keyId}`);
      queryClient.invalidateQueries({ queryKey: ['bana-api-keys'] });
      toast.success('API key revoked');
    } catch (err) {
      toast.error('Failed to revoke key');
    }
  };

  const copyText = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (isLoading) return <LoadingSpinner />;

  const apiUrl = `${window.location.origin}/api/bana/v1/${project.slug}`;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          API Keys ({data?.keys?.length || 0})
        </h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Generate Key
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* API URL info */}
        <div className="border rounded-lg p-3 bg-muted/30">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">REST API Endpoint</h3>
          <div className="flex items-center gap-2">
            <Input value={apiUrl} readOnly className="font-mono text-xs h-8" />
            <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => copyText(apiUrl)}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground space-y-0.5 font-mono">
            <p>GET  {apiUrl}/rest/TABLE_NAME</p>
            <p>POST {apiUrl}/rest/TABLE_NAME</p>
            <p>POST {apiUrl}/auth/signup</p>
            <p>POST {apiUrl}/auth/login</p>
          </div>
        </div>

        {/* Keys list */}
        {data?.keys?.map((key) => (
          <div key={key.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{key.name}</h3>
                <Badge variant={key.role === 'service' ? 'default' : 'secondary'} className="text-[10px]">
                  {key.role}
                </Badge>
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
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-muted-foreground/70">Prefix</span>
                <span className="font-mono">{key.role === 'service' ? 'bana_svc_' : 'bana_'}{key.key_prefix}...</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Created</span>
                <span>{format(new Date(key.created_at), 'MMM d, yyyy')}</span>
              </div>
            </div>
          </div>
        ))}

        {data?.keys?.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            No API keys yet. Generate one to connect external apps.
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Key Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Frontend App" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="anon">anon — Read-only, writes require user auth</option>
                <option value="service">service — Full access, bypasses auth</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name || creating}>
              {creating ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show new key */}
      <Dialog open={!!newKeyResult} onOpenChange={() => setNewKeyResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Generated</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-amber-400">
              Copy this key now. It will not be shown again.
            </p>
            <div className="flex items-center gap-2">
              <Input value={newKeyResult?.api_key || ''} readOnly className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => copyText(newKeyResult?.api_key)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1 font-mono bg-muted p-3 rounded">
              <p># Example: Read data</p>
              <p>curl -H "apikey: {newKeyResult?.api_key?.slice(0, 20)}..." \</p>
              <p>  {apiUrl}/rest/TABLE_NAME</p>
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
