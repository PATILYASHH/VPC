import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

const TARGET_TYPES = [
  { id: 'device', label: 'Single Device' },
  { id: 'topic', label: 'Topic' },
  { id: 'broadcast', label: 'All Devices' },
];

export default function Compose({ project }) {
  const [targetType, setTargetType] = useState('broadcast');
  const [targetValue, setTargetValue] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  const pollStatus = (messageId) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/admin/notify/projects/${project.id}/messages/${messageId}`);
        setLastMessage(data.message);
        if (data.message.status === 'completed' || data.message.status === 'expired') {
          clearInterval(pollRef.current);
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 2000);
  };

  const handleSend = async () => {
    if (targetType !== 'broadcast' && !targetValue) {
      toast.error(targetType === 'device' ? 'Device ID is required' : 'Topic is required');
      return;
    }
    setSending(true);
    setLastMessage(null);
    try {
      const target = targetType === 'broadcast'
        ? { type: 'broadcast' }
        : targetType === 'device'
        ? { type: 'device', device_id: targetValue }
        : { type: 'topic', topic: targetValue };

      const { data } = await api.post(`/admin/notify/projects/${project.id}/send`, {
        target, title, body,
      });
      toast.success(`Queued for ${data.message.target_device_count} device(s)`);
      setLastMessage(data.message);
      pollStatus(data.message.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4 max-w-xl">
      <div>
        <h2 className="text-sm font-semibold">Compose</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Send a test notification through this project</p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Target</Label>
          <div className="flex gap-1.5">
            {TARGET_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTargetType(t.id)}
                className={`px-2.5 py-1 rounded text-[11px] border transition-colors ${
                  targetType === t.id
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {targetType !== 'broadcast' && (
          <div className="space-y-1">
            <Label className="text-xs">{targetType === 'device' ? 'Device ID' : 'Topic'}</Label>
            <Input
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={targetType === 'device' ? 'device UUID' : 'e.g. news'}
              className="text-sm font-mono"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New message" className="text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Body</Label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="You have a new message"
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-y"
          />
        </div>

        <Button onClick={handleSend} disabled={sending} className="w-full">
          {sending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </div>

      {lastMessage && (
        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Delivery status</span>
            <Badge variant="outline" className="text-[10px] font-mono">{lastMessage.status}</Badge>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
            <div>
              <span className="block">Targeted</span>
              <span className="font-mono text-foreground">{lastMessage.target_device_count}</span>
            </div>
            <div>
              <span className="block">Delivered</span>
              <span className="font-mono text-foreground">{lastMessage.delivered_count_live ?? lastMessage.delivered_count ?? 0}</span>
            </div>
            <div>
              <span className="block">Pending</span>
              <span className="font-mono text-foreground">{lastMessage.pending_count ?? 0}</span>
            </div>
            <div>
              <span className="block">Failed</span>
              <span className="font-mono text-foreground">{lastMessage.failed_count_live ?? lastMessage.failed_count ?? 0}</span>
            </div>
          </div>
          {lastMessage.target_device_count === 0 && (
            <p className="text-[10px] text-amber-400">No devices matched this target — nothing was queued.</p>
          )}
          {lastMessage.pending_count > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Rows stay "queued" until the WebSocket gateway (M2) is wired up — this milestone only validates targeting and persistence.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
