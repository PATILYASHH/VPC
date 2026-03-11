import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, ShieldCheck, ShieldOff, QrCode, Pencil, Crown, Lock, KeyRound } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';

const PERMISSION_OPTIONS = [
  { key: 'servers', label: 'Server Manager' },
  { key: 'databases', label: 'Databases' },
  { key: 'banadb', label: 'DB' },
  { key: 'api_keys', label: 'API Keys' },
  { key: 'integrations', label: 'Integrations' },
  { key: 'backups', label: 'Backups' },
  { key: 'logs', label: 'Logs' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'users', label: 'User Management' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'web_hosting', label: 'Web Hosting' },
  { key: 'ai_agent', label: 'AI Agent' },
];

export default function VpcAuth() {
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const [totpSetup, setTotpSetup] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', display_name: '' });
  const [permForm, setPermForm] = useState({ all: true });
  const [resetPwUser, setResetPwUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery('admin-users', '/admin/users');

  const resetForm = () => setForm({ username: '', email: '', password: '', display_name: '' });

  const openEdit = (user) => {
    setForm({ username: user.username, email: user.email, password: '', display_name: user.display_name || '' });
    setEditUser(user);
  };

  const openPerms = (user) => {
    setPermForm(user.permissions || { all: true });
    setPermUser(user);
  };

  const toggleAllPermissions = (checked) => {
    if (checked) {
      setPermForm({ all: true });
    } else {
      // Switch to specific permissions - enable all by default
      const perms = {};
      PERMISSION_OPTIONS.forEach((p) => { perms[p.key] = true; });
      setPermForm(perms);
    }
  };

  const togglePermission = (key) => {
    setPermForm((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSavePerms = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/users/${permUser.id}`, { permissions: permForm });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Permissions updated');
      setPermUser(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update permissions');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!form.username || !form.email || !form.password) return;
    setSaving(true);
    try {
      await api.post('/admin/users', form);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User created');
      setShowCreate(false);
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      await api.put(`/admin/users/${editUser.id}`, payload);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User updated');
      setEditUser(null);
      resetForm();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update user');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (user) => {
    if (!confirm(`Deactivate user "${user.username}"?`)) return;
    try {
      await api.delete(`/admin/users/${user.id}`);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deactivated');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to deactivate user');
    }
  };

  const handleSetupTotp = async (userId) => {
    try {
      const { data } = await api.post(`/admin/users/${userId}/totp/setup`);
      setTotpSetup({ userId, secret: data.secret, qrCode: data.qrCode });
      setVerifyCode('');
    } catch (err) {
      toast.error('Failed to generate TOTP setup');
    }
  };

  const handleVerifyTotp = async () => {
    if (verifyCode.length !== 6) return;
    try {
      await api.post(`/admin/users/${totpSetup.userId}/totp/verify`, { code: verifyCode });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('TOTP enabled successfully');
      setTotpSetup(null);
      setVerifyCode('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid code');
    }
  };

  const handleDisableTotp = async (user) => {
    if (!confirm(`Disable 2FA for "${user.username}"?`)) return;
    try {
      await api.delete(`/admin/users/${user.id}/totp`);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('TOTP disabled');
    } catch (err) {
      toast.error('Failed to disable TOTP');
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/admin/users/${resetPwUser.id}`, { password: newPassword });
      toast.success(`Password updated for "${resetPwUser.username}"`);
      setResetPwUser(null);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  const getPermissionSummary = (permissions) => {
    if (!permissions || permissions.all) return 'Full Access';
    const enabled = PERMISSION_OPTIONS.filter((p) => permissions[p.key]);
    if (enabled.length === 0) return 'No Access';
    if (enabled.length === PERMISSION_OPTIONS.length) return 'Full Access';
    return `${enabled.length}/${PERMISSION_OPTIONS.length} permissions`;
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Admin Users ({data?.users?.length || 0})
        </h2>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add User
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {data?.users?.map((user) => (
          <div key={user.id} className="border rounded-lg p-4 bg-card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{user.display_name || user.username}</h3>
                <Badge variant={user.is_active ? 'success' : 'destructive'} className="text-[10px]">
                  {user.is_active ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant={user.totp_enabled ? 'success' : 'outline'} className="text-[10px]">
                  {user.totp_enabled ? (
                    <span className="flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> 2FA</span>
                  ) : (
                    <span className="flex items-center gap-1"><ShieldOff className="w-3 h-3" /> No 2FA</span>
                  )}
                </Badge>
                <Badge
                  variant={user.permissions?.all ? 'default' : 'secondary'}
                  className="text-[10px] cursor-pointer"
                  onClick={() => openPerms(user)}
                >
                  {user.permissions?.all ? (
                    <span className="flex items-center gap-1"><Crown className="w-3 h-3" /> Full Access</span>
                  ) : (
                    <span className="flex items-center gap-1"><Lock className="w-3 h-3" /> {getPermissionSummary(user.permissions)}</span>
                  )}
                </Badge>
              </div>
              <div className="flex items-center gap-1">
                {user.totp_enabled ? (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleDisableTotp(user)}>
                    Disable 2FA
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => handleSetupTotp(user.id)}>
                    <QrCode className="w-3.5 h-3.5 mr-1" /> Setup 2FA
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => openPerms(user)}>
                  <Lock className="w-3.5 h-3.5 mr-1" /> Permissions
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setResetPwUser(user); setNewPassword(''); setConfirmPassword(''); }}>
                  <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset Password
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(user)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeactivate(user)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>
                <span className="block text-muted-foreground/70">Email</span>
                <span>{user.email}</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Username</span>
                <span className="font-mono">{user.username}</span>
              </div>
              <div>
                <span className="block text-muted-foreground/70">Last Login</span>
                <span>{user.last_login_at ? format(new Date(user.last_login_at), 'MMM d, yyyy HH:mm') : 'Never'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Admin User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="johndoe" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="john@example.com" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Display Name (optional)</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="John Doe" className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.username || !form.email || !form.password || saving}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => { setEditUser(null); resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">New Password (leave empty to keep current)</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave empty to keep current" className="text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Display Name</Label>
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className="text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditUser(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!permUser} onOpenChange={() => setPermUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Permissions — {permUser?.display_name || permUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Full Access Toggle */}
            <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
              <input
                type="checkbox"
                checked={!!permForm.all}
                onChange={(e) => toggleAllPermissions(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm font-medium">Full Access</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Grants access to all features without restrictions
                </p>
              </div>
            </label>

            {/* Individual Permissions */}
            {!permForm.all && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium px-1 mb-2">Specific Permissions</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {PERMISSION_OPTIONS.map((perm) => (
                    <label
                      key={perm.key}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer hover:bg-accent/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={!!permForm[perm.key]}
                        onChange={() => togglePermission(perm.key)}
                        className="w-3.5 h-3.5 rounded accent-primary"
                      />
                      <span className="text-xs">{perm.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermUser(null)}>Cancel</Button>
            <Button onClick={handleSavePerms} disabled={saving}>
              {saving ? 'Saving...' : 'Save Permissions'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetPwUser} onOpenChange={() => { setResetPwUser(null); setNewPassword(''); setConfirmPassword(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {resetPwUser?.display_name || resetPwUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 characters" className="text-sm" />
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
            <Button onClick={handleResetPassword} disabled={!newPassword || newPassword.length < 8 || newPassword !== confirmPassword || saving}>
              {saving ? 'Saving...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TOTP Setup Dialog */}
      <Dialog open={!!totpSetup} onOpenChange={() => { setTotpSetup(null); setVerifyCode(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setup Two-Factor Authentication</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with Google Authenticator or any TOTP app.
            </p>
            {totpSetup?.qrCode && (
              <div className="flex justify-center">
                <img src={totpSetup.qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-lg" />
              </div>
            )}
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Or enter this secret manually:</p>
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded select-all">{totpSetup?.secret}</code>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Verification Code</Label>
              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                maxLength={6}
                inputMode="numeric"
                className="text-center text-lg font-mono tracking-widest"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTotpSetup(null); setVerifyCode(''); }}>Cancel</Button>
            <Button onClick={handleVerifyTotp} disabled={verifyCode.length !== 6}>
              Verify & Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
