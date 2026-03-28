import { useState } from 'react';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useApiQuery, useApiMutation } from '@/hooks/useApi';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { toast } from 'sonner';
import api from '@/lib/api';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TokenManager() {
  const [showCreate, setShowCreate] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, refetch } = useApiQuery('vpshub-tokens', '/admin/vpshub/tokens');
  const tokens = data?.tokens || [];

  async function handleCreate(e) {
    e.preventDefault();
    if (!tokenName.trim()) return;

    setCreating(true);
    try {
      const { data } = await api.post('/admin/vpshub/tokens', { name: tokenName.trim() });
      setNewToken(data.token);
      setTokenName('');
      setShowCreate(false);
      refetch();
      toast.success('Token created');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create token');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(tokenId) {
    try {
      await api.delete(`/admin/vpshub/tokens/${tokenId}`);
      refetch();
      toast.success('Token revoked');
    } catch (err) {
      toast.error('Failed to revoke token');
    }
  }

  function copyToken() {
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold">Personal Access Tokens</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tokens are used for git clone/push/pull authentication.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Token
        </Button>
      </div>

      {/* Newly created token display */}
      {newToken && (
        <div className="mb-6 border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm mb-1">Copy your personal access token now</p>
              <p className="text-xs text-muted-foreground mb-3">
                You won't be able to see it again. Use it as your password when cloning.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-background border rounded px-3 py-2 font-mono break-all">
                  {newToken}
                </code>
                <Button variant="outline" size="sm" onClick={copyToken} className="shrink-0">
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Use: <code className="bg-background px-1 rounded">git clone http://username:{newToken.slice(0, 8)}...@server/git/owner/repo.git</code>
              </p>
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button variant="ghost" size="sm" onClick={() => setNewToken(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <div className="mb-6 border rounded-lg p-4 bg-card">
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label>Token Name</Label>
              <Input
                value={tokenName}
                onChange={e => setTokenName(e.target.value)}
                placeholder="e.g. My Laptop, VS Code, CI/CD"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!tokenName.trim() || creating}>
                {creating ? 'Creating...' : 'Create Token'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Key className="w-12 h-12 mb-3 opacity-30" />
          <p className="text-sm">No tokens yet. Create one to use git clone/push.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map(token => (
            <div key={token.id} className="flex items-center justify-between border rounded-lg p-4 bg-card">
              <div className="flex items-center gap-3">
                <Key className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium text-sm">{token.name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono">{token.token_prefix}...</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last used: {timeAgo(token.last_used_at)}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(token.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Usage guide */}
      <div className="mt-8 border rounded-lg p-4 bg-card">
        <h3 className="font-medium text-sm mb-2">How to use tokens</h3>
        <div className="text-xs text-muted-foreground space-y-2">
          <p>When cloning or pushing to VPSHub, git will ask for credentials:</p>
          <pre className="bg-background rounded p-2 font-mono">
{`Username: your_vpc_username
Password: vpshub_xxxxxxxxxxxx (your token)`}
          </pre>
          <p>Or include in the URL:</p>
          <pre className="bg-background rounded p-2 font-mono">
{`git clone http://username:token@server/git/owner/repo.git`}
          </pre>
        </div>
      </div>
    </div>
  );
}
