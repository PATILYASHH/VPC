import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Copy, Eye, EyeOff, RefreshCw, Globe, Key, Shield, AlertTriangle, Code2,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/useApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import api from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

export default function ApiKeys({ project }) {
  const [showClient, setShowClient] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [activeTab, setActiveTab] = useState('kotlin');
  const queryClient = useQueryClient();

  const baseUrl = `/admin/notify/projects/${project.id}`;
  const { data, isLoading } = useApiQuery(
    ['notify-api-keys', project.id],
    `${baseUrl}/api-keys`
  );

  const keys = data?.keys || [];
  const clientKey = keys.find((k) => k.role === 'client' && k.is_active);
  const serverKey = keys.find((k) => k.role === 'server' && k.is_active);

  const apiUrl = `${window.location.origin}/api/notify/v1`;

  const handleRegenerate = async (role) => {
    if (!confirm(`Regenerate ${role} key? Current key will stop working immediately.`)) return;
    setRegenerating(role);
    try {
      await api.post(`${baseUrl}/api-keys/regenerate`, { role });
      queryClient.invalidateQueries({ queryKey: ['notify-api-keys', project.id] });
      toast.success(`${role} key regenerated`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to regenerate');
    } finally {
      setRegenerating(null);
    }
  };

  const maskKey = (key) => {
    if (!key) return '••••••••••••••••••••••••••••••••••••••••';
    const prefixEnd = key.indexOf('_', 5) + 1;
    return key.slice(0, prefixEnd) + key.slice(prefixEnd, prefixEnd + 4) + '••••••••••••••••••••••••••••';
  };

  if (isLoading) return <LoadingSpinner />;

  const clientKeyStr = clientKey?.api_key || 'YOUR_CLIENT_KEY';
  const serverKeyStr = serverKey?.api_key || 'YOUR_SERVER_KEY';

  return (
    <div className="h-full overflow-auto p-4 space-y-5 max-w-2xl">
      <div>
        <h2 className="text-sm font-semibold">API</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Android app and your backend using these credentials.
        </p>
      </div>

      <div className="border rounded-lg divide-y">
        <KeyRow
          icon={<Globe className="w-3.5 h-3.5 text-muted-foreground" />}
          label="Gateway URL"
          value={apiUrl}
          onCopy={() => copyToClipboard(apiUrl)}
        />
        <KeyRow
          icon={<Key className="w-3.5 h-3.5 text-blue-400" />}
          label="client key"
          badge={<Badge variant="secondary" className="text-[9px] ml-1.5">embed in APK</Badge>}
          value={showClient ? clientKeyStr : maskKey(clientKey?.api_key)}
          onCopy={() => copyToClipboard(clientKeyStr)}
          onToggle={() => setShowClient(!showClient)}
          showToggle
          isRevealed={showClient}
          onRegenerate={() => handleRegenerate('client')}
          regenerating={regenerating === 'client'}
        />
        <KeyRow
          icon={<Shield className="w-3.5 h-3.5 text-amber-400" />}
          label="server key"
          badge={<Badge variant="destructive" className="text-[9px] ml-1.5">secret</Badge>}
          value={showServer ? serverKeyStr : maskKey(serverKey?.api_key)}
          onCopy={() => copyToClipboard(serverKeyStr)}
          onToggle={() => setShowServer(!showServer)}
          showToggle
          isRevealed={showServer}
          onRegenerate={() => handleRegenerate('server')}
          regenerating={regenerating === 'server'}
        />
      </div>

      <div className="flex items-start gap-2 text-[10px] text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>
          The <strong>client key</strong> is safe to ship inside your APK — it's decompilable by design and can
          only register devices, connect, and subscribe to topics. The <strong>server key</strong> can send
          notifications and read delivery status — keep it on your backend, never in a client binary.
        </span>
      </div>

      <div className="border rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b">
          <Code2 className="w-3.5 h-3.5 text-primary" />
          <h3 className="text-xs font-medium">Getting Started</h3>
        </div>

        <div className="flex border-b">
          {['kotlin', 'curl'].map((tab) => (
            <button
              key={tab}
              className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'kotlin' ? 'Android (Kotlin)' : 'cURL (server)'}
            </button>
          ))}
        </div>

        <div className="p-3 space-y-4">
          {activeTab === 'kotlin' && (
            <>
              <CodeBlock title="build.gradle.kts" code={`dependencies {
    implementation("com.vpc.notify:notify-client:1.0.0")
}`} />
              <CodeBlock title="AndroidManifest.xml" code={`<meta-data
    android:name="com.vpc.notify.API_KEY"
    android:value="${clientKeyStr.slice(0, 20)}..." />`} />
              <CodeBlock title="Register + receive" code={`NotifyClient.init(context, apiKey = "${clientKeyStr.slice(0, 20)}...")
NotifyClient.register { result ->
    Log.d("Notify", "Registered device \${result.deviceId}")
}
NotifyClient.setOnNotificationReceivedListener { notification ->
    // notification.title, notification.body, notification.data
}`} />
            </>
          )}

          {activeTab === 'curl' && (
            <>
              <CodeBlock title="Send to a single device" code={`curl -X POST ${apiUrl}/send \\
  -H "apikey: ${serverKeyStr.slice(0, 20)}..." \\
  -H "Content-Type: application/json" \\
  -d '{"target":{"type":"device","device_id":"DEVICE_UUID"},"title":"Hello","body":"You have a new message"}'`} />
              <CodeBlock title="Send to a topic" code={`curl -X POST ${apiUrl}/send \\
  -H "apikey: YOUR_SERVER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"target":{"type":"topic","topic":"news"},"title":"New post","body":"Check it out"}'`} />
              <CodeBlock title="Check delivery status" code={`curl ${apiUrl}/messages/MESSAGE_ID \\
  -H "apikey: YOUR_SERVER_KEY"`} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KeyRow({ icon, label, badge, value, onCopy, onToggle, showToggle, isRevealed, onRegenerate, regenerating }) {
  return (
    <div className="p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          {icon}
          <span className="text-[11px] font-medium ml-1.5">{label}</span>
          {badge}
        </div>
        {onRegenerate && (
          <button
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            <RefreshCw className={`w-2.5 h-2.5 ${regenerating ? 'animate-spin' : ''}`} />
            Regenerate
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={value} readOnly className="font-mono text-[11px] h-7 bg-muted/30" />
        {showToggle && (
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onToggle}>
            {isRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onCopy}>
          <Copy className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

function CodeBlock({ title, code }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-muted-foreground mb-1">{title}</p>
      <div className="relative group">
        <pre className="text-[10px] bg-muted/40 rounded p-2.5 overflow-x-auto font-mono leading-relaxed whitespace-pre text-muted-foreground">{code}</pre>
        <button
          className="absolute top-1.5 right-1.5 p-1 rounded bg-muted/80 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => copyToClipboard(code)}
        >
          <Copy className="w-2.5 h-2.5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
