import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, UserCheck, UserX, KeyRound, Mail, Settings as SettingsIcon, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'providers', label: 'Providers' },
];

const PROVIDER_BADGE = {
  email: { label: 'Email', className: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  google: { label: 'Google', className: 'bg-red-500/15 text-red-300 border-red-500/30' },
  github: { label: 'GitHub', className: 'bg-zinc-500/15 text-zinc-200 border-zinc-500/30' },
};

const PROVIDER_META = {
  google: {
    label: 'Google',
    description: 'Sign in with Google OAuth 2.0',
    clientIdPlaceholder: '123456789.apps.googleusercontent.com',
    clientSecretPlaceholder: 'GOCSPX-...',
  },
  github: {
    label: 'GitHub',
    description: 'Sign in with GitHub OAuth App',
    clientIdPlaceholder: 'Iv1.abcdefghijklmnop',
    clientSecretPlaceholder: 'github_pat_... or 40-char secret',
  },
};

function ProviderIcon({ provider, className }) {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.6 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.7 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.4 0-.6-.1-1.1-.2-1.6H12z"/>
      </svg>
    );
  }
  if (provider === 'github') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path fill="currentColor" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.16-.02-2.1-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12c0-6.35-5.15-11.5-11.5-11.5z"/>
      </svg>
    );
  }
  return <Mail className={className} />;
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
      title="Copy"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

function OAuthProviderCard({ project, provider, providersData, queryClient }) {
  const meta = PROVIDER_META[provider];
  const baseUrl = `/admin/db/projects/${project.id}`;
  const initial = providersData?.providers?.find((p) => p.provider === provider);
  const [enabled, setEnabled] = useState(!!initial?.enabled);
  // Expand the config when the provider is enabled, or after the user toggles it on.
  const [expanded, setExpanded] = useState(!!initial?.enabled);
  const [clientId, setClientId] = useState(initial?.client_id || '');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const callbackUrl = providersData?.callback_base_url
    ? `${providersData.callback_base_url}/${provider}`
    : '';
  const authorizeUrl = providersData?.authorize_base_url
    ? `${providersData.authorize_base_url}/${provider}?redirect_to=YOUR_APP_URL`
    : '';

  const hasExistingSecret = !!initial?.has_client_secret;

  const handleSave = async () => {
    if (enabled && !clientId.trim()) {
      toast.error('Client ID is required');
      return;
    }
    if (enabled && !hasExistingSecret && !clientSecret.trim()) {
      toast.error('Client Secret is required');
      return;
    }
    setSaving(true);
    try {
      const body = { enabled, clientId: clientId.trim() };
      if (clientSecret.trim()) body.clientSecret = clientSecret.trim();
      await api.put(`${baseUrl}/auth/providers/${provider}`, body);
      toast.success(enabled ? `${meta.label} sign-in enabled` : `${meta.label} sign-in disabled`);
      setClientSecret('');
      queryClient.invalidateQueries({ queryKey: ['db-auth-providers', project.id] });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save provider config');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = (checked) => {
    setEnabled(checked);
    if (checked) setExpanded(true);
  };

  const consoleHint = provider === 'google'
    ? 'Add this exact URL to your Google Cloud Console OAuth client → Authorized redirect URIs'
    : 'Add this exact URL to your GitHub OAuth App → Authorization callback URL';

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center gap-3 p-4 text-left transition-colors',
          expanded ? 'bg-muted/30 border-b' : 'hover:bg-muted/20'
        )}
      >
        <ProviderIcon provider={provider} className="w-5 h-5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium">{meta.label}</div>
          <div className="text-xs text-muted-foreground">{meta.description}</div>
        </div>
        <Badge variant={enabled ? 'success' : 'outline'} className="text-[10px]">
          {enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        <span onClick={(e) => e.stopPropagation()}>
          <Switch checked={enabled} onCheckedChange={handleToggle} />
        </span>
      </button>

      {!expanded ? null : (
      <div className="p-4 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Callback URL (Authorized redirect URI)</Label>
          <div className="flex items-center gap-1">
            <Input
              readOnly
              value={callbackUrl}
              className="text-xs font-mono bg-muted/50"
              onClick={(e) => e.target.select()}
            />
            {callbackUrl && <CopyButton value={callbackUrl} />}
          </div>
          <p className="text-[11px] text-muted-foreground">{consoleHint}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Client ID</Label>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={meta.clientIdPlaceholder}
            className="text-xs font-mono"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">
            Client Secret
            {hasExistingSecret && (
              <span className="ml-2 text-[10px] text-muted-foreground">(stored — leave blank to keep)</span>
            )}
          </Label>
          <div className="flex items-center gap-1">
            <Input
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={hasExistingSecret ? '••••••••••••' : meta.clientSecretPlaceholder}
              className="text-xs font-mono"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSecret((s) => !s)}
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {authorizeUrl && (
          <div className="space-y-1">
            <Label className="text-xs">Authorize URL (use this from your app)</Label>
            <div className="flex items-center gap-1">
              <Input readOnly value={authorizeUrl} className="text-xs font-mono bg-muted/50" />
              <CopyButton value={authorizeUrl} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Redirect users here. We'll send them back to <code>YOUR_APP_URL</code> with{' '}
              <code>#access_token=…</code> on success.
            </p>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

export default function Auth({ project }) {
  const [tab, setTab] = useState('users');
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetPwUser, setResetPwUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/db/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['db-auth-users', project.id],
    `${baseUrl}/auth/users`
  );
  const { data: providersData, isLoading: loadingProviders } = useApiQuery(
    ['db-auth-providers', project.id],
    `${baseUrl}/auth/providers`
  );

  const handleCreate = async () => {
    if (!email || !password) return;
    setCreating(true);
    try {
      await api.post(`${baseUrl}/auth/users`, { email, password });
      queryClient.invalidateQueries({ queryKey: ['db-auth-users'] });
      toast.success('User created');
      setShowCreate(false);
      setEmail('');
      setPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (userId) => {
    try {
      await api.patch(`${baseUrl}/auth/users/${userId}`);
      queryClient.invalidateQueries({ queryKey: ['db-auth-users'] });
      toast.success('User updated');
    } catch (err) {
      toast.error('Failed to update user');
    }
  };

  const handleDelete = async (userId, userEmail) => {
    if (!confirm(`Delete user "${userEmail}"?`)) return;
    try {
      await api.delete(`${baseUrl}/auth/users/${userId}`);
      queryClient.invalidateQueries({ queryKey: ['db-auth-users'] });
      toast.success('User deleted');
    } catch (err) {
      toast.error('Failed to delete user');
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.put(`${baseUrl}/auth/users/${resetPwUser.id}/password`, { password: newPassword });
      toast.success(`Password updated for "${resetPwUser.email}"`);
      setResetPwUser(null);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 pt-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Authentication
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage users and sign-in providers for {project.name}
            </p>
          </div>
          {tab === 'users' && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add User
            </Button>
          )}
        </div>
        <div className="flex gap-1 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-2 text-xs font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              {t.id === 'users' && data?.users && (
                <span className="ml-1.5 text-muted-foreground">({data.users.length})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'users' && (
          data?.users?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <p className="text-sm">No auth users yet</p>
              <p className="text-xs mt-1">Add users who can authenticate via the REST API</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Provider</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Last Login</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.users?.map((user) => {
                  const provider = user.provider || 'email';
                  const badge = PROVIDER_BADGE[provider] || PROVIDER_BADGE.email;
                  const isOAuth = provider !== 'email';
                  return (
                    <tr key={user.id} className="border-b hover:bg-accent/30">
                      <td className="p-3 font-mono">
                        <div className="flex items-center gap-2">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
                          ) : (
                            <ProviderIcon provider={provider} className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <span>{user.email}</span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge className={cn('text-[10px] border', badge.className)}>{badge.label}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={user.is_active ? 'success' : 'destructive'} className="text-[10px]">
                          {user.is_active ? 'Active' : 'Disabled'}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {user.last_login_at ? format(new Date(user.last_login_at), 'MMM d, HH:mm') : 'Never'}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {format(new Date(user.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!isOAuth && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => { setResetPwUser(user); setNewPassword(''); setConfirmPassword(''); }}
                              title="Reset Password"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleToggle(user.id)}
                            title={user.is_active ? 'Disable' : 'Enable'}
                          >
                            {user.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleDelete(user.id, user.email)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'providers' && (
          <div className="p-4 space-y-4 max-w-2xl">
            <div className="text-xs text-muted-foreground">
              Configure third-party sign-in providers. End users hit the authorize URL from your app and
              are redirected back with an access token after signing in.
            </div>
            {loadingProviders ? (
              <LoadingSpinner />
            ) : (
              <>
                <OAuthProviderCard
                  project={project}
                  provider="google"
                  providersData={providersData}
                  queryClient={queryClient}
                />
                <OAuthProviderCard
                  project={project}
                  provider="github"
                  providersData={providersData}
                  queryClient={queryClient}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Auth User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!email || !password || creating}>
              {creating ? 'Creating...' : 'Add User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwUser} onOpenChange={() => { setResetPwUser(null); setNewPassword(''); setConfirmPassword(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {resetPwUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Confirm Password</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" className="text-sm" />
            </div>
            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-destructive">Passwords do not match</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPwUser(null); setNewPassword(''); setConfirmPassword(''); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={!newPassword || newPassword.length < 6 || newPassword !== confirmPassword || saving}>
              {saving ? 'Saving...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
