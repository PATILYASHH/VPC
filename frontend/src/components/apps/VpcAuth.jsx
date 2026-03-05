import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, ShieldCheck, ShieldOff, QrCode, Pencil } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';

export default function VpcAuth() {
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [totpSetup, setTotpSetup] = useState(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', password: '', display_name: '' });

  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery('admin-users', '/admin/users');

  const resetForm = () => setForm({ username: '', email: '', password: '', display_name: '' });

  const openEdit = (user) => {
    setForm({ username: user.username, email: user.email, password: '', display_name: user.display_name || '' });
    setEditUser(user);
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
