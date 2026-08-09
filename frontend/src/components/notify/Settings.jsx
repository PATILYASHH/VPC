import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

export default function Settings({ project }) {
  const [name, setName] = useState(project.name);
  const [androidPackageName, setAndroidPackageName] = useState(project.android_package_name || '');
  const [maxDevices, setMaxDevices] = useState(project.max_devices);
  const [maxQueuePerDevice, setMaxQueuePerDevice] = useState(project.max_queue_per_device);
  const [defaultTtlSeconds, setDefaultTtlSeconds] = useState(project.default_ttl_seconds);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    setName(project.name);
    setAndroidPackageName(project.android_package_name || '');
    setMaxDevices(project.max_devices);
    setMaxQueuePerDevice(project.max_queue_per_device);
    setDefaultTtlSeconds(project.default_ttl_seconds);
  }, [project.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/notify/projects/${project.id}/settings`, {
        name, androidPackageName, maxDevices, maxQueuePerDevice, defaultTtlSeconds,
      });
      queryClient.invalidateQueries({ queryKey: ['notify-projects'] });
      queryClient.invalidateQueries({ queryKey: ['notify-project', project.id] });
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete project "${project.name}"? Devices, keys, and message history will be permanently removed.`)) return;
    try {
      await api.delete(`/admin/notify/projects/${project.id}`, { data: { confirm: true } });
      queryClient.invalidateQueries({ queryKey: ['notify-projects'] });
      toast.success('Project deleted');
      // Parent will handle navigation back
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete project');
    }
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-5 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold">Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Project configuration and limits</p>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Project Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Android Package Name</Label>
          <Input value={androidPackageName} onChange={(e) => setAndroidPackageName(e.target.value)} placeholder="com.example.myapp" className="text-sm font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Max Devices</Label>
            <Input type="number" value={maxDevices} onChange={(e) => setMaxDevices(parseInt(e.target.value) || 0)} className="text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max Queue / Device</Label>
            <Input type="number" value={maxQueuePerDevice} onChange={(e) => setMaxQueuePerDevice(parseInt(e.target.value) || 0)} className="text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Default TTL (seconds)</Label>
          <Input type="number" value={defaultTtlSeconds} onChange={(e) => setDefaultTtlSeconds(parseInt(e.target.value) || 0)} className="text-sm" />
          <p className="text-[10px] text-muted-foreground">How long an undelivered message stays queued before expiring, when the caller doesn't set ttl_seconds.</p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      <div className="border border-destructive/30 rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-medium text-destructive">Danger Zone</h3>
        <p className="text-[10px] text-muted-foreground">Deleting a project removes all devices, API keys, and message history. This cannot be undone.</p>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete Project
        </Button>
      </div>
    </div>
  );
}
