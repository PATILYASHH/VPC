import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { format } from 'date-fns';

export default function BanaAuth({ project }) {
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const baseUrl = `/admin/bana/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['bana-auth-users', project.id],
    `${baseUrl}/auth/users`
  );

  const handleCreate = async () => {
    if (!email || !password) return;
    setCreating(true);
    try {
      await api.post(`${baseUrl}/auth/users`, { email, password });
      queryClient.invalidateQueries({ queryKey: ['bana-auth-users'] });
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
      queryClient.invalidateQueries({ queryKey: ['bana-auth-users'] });
      toast.success('User updated');
    } catch (err) {
      toast.error('Failed to update user');
    }
  };

  const handleDelete = async (userId, userEmail) => {
    if (!confirm(`Delete user "${userEmail}"?`)) return;
    try {
      await api.delete(`${baseUrl}/auth/users/${userId}`);
      queryClient.invalidateQueries({ queryKey: ['bana-auth-users'] });
      toast.success('User deleted');
    } catch (err) {
      toast.error('Failed to delete user');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Auth Users ({data?.users?.length || 0})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage authentication users for {project.name}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add User
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {data?.users?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">No auth users yet</p>
            <p className="text-xs mt-1">Add users who can authenticate via the REST API</p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Last Login</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.users?.map((user) => (
                <tr key={user.id} className="border-b hover:bg-accent/30">
                  <td className="p-3 font-mono">{user.email}</td>
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
              ))}
            </tbody>
          </table>
        )}
      </div>

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
    </div>
  );
}
