import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Zap, Key, Eye, EyeOff, Save, Loader2, CheckCircle2, XCircle,
  Shield, RefreshCw, AlertTriangle, Settings, Brain,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';

const PERMISSION_GROUPS = [
  {
    label: 'PR Review',
    description: 'AI-powered pull request review',
    items: [
      { key: 'pr_review', label: 'Review individual PRs', description: 'Allow AI to analyze SQL in pull requests' },
      { key: 'auto_review_on_create', label: 'Auto-review on PR creation', description: 'Automatically review SQL when a new PR is created' },
    ],
  },
  {
    label: 'Smart Merge',
    description: 'AI-assisted merge operations',
    items: [
      { key: 'pr_merge_review', label: 'Pre-merge review', description: 'AI reviews SQL before merging' },
      { key: 'smart_merge_analysis', label: 'Smart merge analysis', description: 'Analyze multiple PRs for optimal merge order' },
    ],
  },
  {
    label: 'SQL Analysis',
    description: 'Schema and query analysis',
    items: [
      { key: 'sql_review', label: 'SQL review', description: 'Review arbitrary SQL for risks and improvements' },
      { key: 'schema_suggestions', label: 'Schema suggestions', description: 'Suggest schema improvements based on current structure' },
    ],
  },
];

const MODELS = [
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', description: 'Fast, cost-effective' },
  { value: 'claude-opus-4-20250514', label: 'Claude Opus 4', description: 'Most capable, higher cost' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest, lowest cost' },
];

export default function AgentSettings() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savedKeyMask, setSavedKeyMask] = useState('');
  const [keyIsSet, setKeyIsSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [savingPerms, setSavingPerms] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const [settingsRes, permsRes] = await Promise.all([
        api.get('/admin/settings/anthropic_api_key'),
        api.get('/admin/settings/ai-agent/permissions'),
      ]);
      if (settingsRes.data.is_set) {
        setKeyIsSet(true);
        setSavedKeyMask(settingsRes.data.value || '***');
      }
      setPermissions(permsRes.data.permissions);
    } catch {
      // Settings table might not exist yet, use defaults
      setPermissions(getDefaults());
    } finally {
      setLoading(false);
    }
  }

  function getDefaults() {
    return {
      pr_review: true,
      pr_merge_review: true,
      smart_merge_analysis: true,
      sql_review: true,
      schema_suggestions: false,
      auto_review_on_create: false,
      max_tokens_per_request: 4000,
      model: 'claude-sonnet-4-20250514',
    };
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await api.put('/admin/settings/anthropic_api_key', { value: apiKey.trim(), is_secret: true });
      toast.success('API key saved and encrypted');
      setKeyIsSet(true);
      setSavedKeyMask(apiKey.slice(0, 8) + '...' + apiKey.slice(-4));
      setApiKey('');
      setShowKey(false);
      setTestResult(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save API key');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveKey() {
    if (!confirm('Remove the API key? AI features will stop working.')) return;
    try {
      await api.delete('/admin/settings/anthropic_api_key');
      toast.success('API key removed');
      setKeyIsSet(false);
      setSavedKeyMask('');
      setApiKey('');
      setTestResult(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove');
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/admin/settings/ai-agent/test');
      setTestResult(data);
      if (data.success) {
        toast.success('Connection successful');
      } else {
        toast.error(data.error || 'Connection failed');
      }
    } catch (err) {
      setTestResult({ success: false, error: err.response?.data?.error || 'Test failed' });
      toast.error('Connection test failed');
    } finally {
      setTesting(false);
    }
  }

  function togglePerm(key) {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSavePermissions() {
    setSavingPerms(true);
    try {
      await api.put('/admin/settings/ai-agent/permissions', { permissions });
      toast.success('Permissions saved');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save permissions');
    } finally {
      setSavingPerms(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-400" />
          <h1 className="text-sm font-semibold">AI Agent Settings</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Configure Claude AI integration for PR review, smart merge, and SQL analysis</p>
      </div>

      <Tabs defaultValue="connection" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
        </TabsList>

        {/* Connection Tab */}
        <TabsContent value="connection" className="flex-1 overflow-auto p-4">
          <div className="max-w-lg space-y-6">
            {/* API Key Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Anthropic API Key</h3>
              </div>

              {/* Current key status */}
              {keyIsSet && (
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-emerald-400">API key configured</p>
                    <p className="text-xs font-mono text-muted-foreground">{savedKeyMask}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={handleRemoveKey}>
                    Remove
                  </Button>
                </div>
              )}

              {/* Key input */}
              <div className="space-y-1.5">
                <Label className="text-xs">{keyIsSet ? 'Update API Key' : 'API Key'}</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="sk-ant-api03-..."
                      className="text-sm font-mono pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <Button size="sm" onClick={handleSaveKey} disabled={!apiKey.trim() || saving}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Get your API key from{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    console.anthropic.com
                  </a>
                  . It will be encrypted and stored securely.
                </p>
              </div>
            </div>

            {/* Test Connection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Test Connection</h3>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={testing || !keyIsSet}
                >
                  {testing
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing...</>
                    : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Test Connection</>
                  }
                </Button>
              </div>

              {testResult && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border ${
                  testResult.success
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                }`}>
                  {testResult.success ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-emerald-400">Connection successful</p>
                        {testResult.model && <p className="text-[10px] text-muted-foreground">Model: {testResult.model}</p>}
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-red-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-red-400">Connection failed</p>
                        <p className="text-[10px] text-red-400/70 font-mono">{testResult.error}</p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg text-xs text-muted-foreground">
              <AlertTriangle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>The API key is encrypted at rest using AES-256-GCM and only decrypted when making API calls.</p>
                <p>API usage is billed to your Anthropic account. Monitor usage at console.anthropic.com.</p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Permissions Tab */}
        <TabsContent value="permissions" className="flex-1 overflow-auto p-4">
          <div className="max-w-lg space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Agent Permissions
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">Control what the AI agent is allowed to do</p>
              </div>
              <Button size="sm" onClick={handleSavePermissions} disabled={savingPerms}>
                {savingPerms ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                Save Permissions
              </Button>
            </div>

            {permissions && PERMISSION_GROUPS.map(group => (
              <div key={group.label} className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 px-4 py-2 border-b">
                  <h4 className="text-xs font-semibold">{group.label}</h4>
                  <p className="text-[10px] text-muted-foreground">{group.description}</p>
                </div>
                <div className="divide-y">
                  {group.items.map(item => (
                    <label
                      key={item.key}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={!!permissions[item.key]}
                        onChange={() => togglePerm(item.key)}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground">{item.description}</span>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${
                        permissions[item.key] ? 'border-emerald-500/40 text-emerald-400' : 'border-zinc-500/40 text-zinc-500'
                      }`}>
                        {permissions[item.key] ? 'enabled' : 'disabled'}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {/* Token limit */}
            {permissions && (
              <div className="border rounded-lg p-4 space-y-3">
                <h4 className="text-xs font-semibold flex items-center gap-2">
                  <Settings className="w-3.5 h-3.5" /> Rate Limits
                </h4>
                <div className="space-y-1.5">
                  <Label className="text-xs">Max tokens per request</Label>
                  <Input
                    type="number"
                    min={100}
                    max={100000}
                    value={permissions.max_tokens_per_request || 4000}
                    onChange={e => setPermissions(prev => ({ ...prev, max_tokens_per_request: parseInt(e.target.value) || 4000 }))}
                    className="text-sm font-mono w-40"
                  />
                  <p className="text-[10px] text-muted-foreground">Higher values allow longer responses but cost more</p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Model Tab */}
        <TabsContent value="model" className="flex-1 overflow-auto p-4">
          <div className="max-w-lg space-y-4">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Brain className="w-4 h-4" /> Model Selection
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Choose which Claude model the agent uses</p>
            </div>

            {permissions && (
              <div className="space-y-2">
                {MODELS.map(m => (
                  <label
                    key={m.value}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      permissions.model === m.value
                        ? 'border-purple-500/50 bg-purple-500/5'
                        : 'hover:border-muted-foreground/30'
                    }`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.value}
                      checked={permissions.model === m.value}
                      onChange={() => setPermissions(prev => ({ ...prev, model: m.value }))}
                      className="accent-purple-500"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium block">{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">{m.description}</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{m.value.split('-').slice(0, 2).join('-')}</span>
                  </label>
                ))}
              </div>
            )}

            <Button size="sm" onClick={handleSavePermissions} disabled={savingPerms}>
              {savingPerms ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
              Save Model Selection
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
