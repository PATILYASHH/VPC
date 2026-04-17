import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Brain, MessageSquare, User, BookOpen, Send, Loader2, Trash2, Plus, Save,
  CheckCircle2, XCircle, RefreshCw, AlertTriangle, Settings, Bell, Zap,
  Terminal, Star, StarOff, Cpu, Key, ChevronDown, Play, Eye, EyeOff,
  CircleDot, Download, ListTodo, Activity, MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';

const CATEGORIES = ['general', 'preference', 'project', 'technical'];

const NAV_ITEMS = [
  { id: 'providers', label: 'Providers', icon: Cpu, desc: 'AI models & keys' },
  { id: 'personality', label: 'System Prompt', icon: Brain, desc: 'Bot personality' },
  { id: 'todos', label: 'Todos', icon: ListTodo, desc: 'Task management' },
  { id: 'memory', label: 'Memory', icon: BookOpen, desc: 'Knowledge base' },
  { id: 'activity', label: 'Activity', icon: Activity, desc: 'Usage logs' },
  { id: 'telegram', label: 'Telegram', icon: MessageCircle, desc: 'Bot integration' },
  { id: 'users', label: 'Users', icon: User, desc: 'Bot users' },
];

export default function AgentSettings() {
  const [tab, setTab] = useState('providers');

  const activeNav = NAV_ITEMS.find(n => n.id === tab);

  return (
    <div className="h-full flex flex-col sm:flex-row" style={{ background: 'var(--surface-0)' }}>
      {/* Sidebar nav */}
      <div className="sm:w-48 border-b sm:border-b-0 sm:border-r shrink-0 flex sm:flex-col" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
        {/* Logo header - desktop only */}
        <div className="hidden sm:flex items-center gap-2.5 px-4 py-3.5 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold leading-none">AI Agent</p>
            <p className="text-[9px] text-muted-foreground/60 mt-0.5">Brain & Config</p>
          </div>
        </div>

        {/* Nav items */}
        <div className="flex sm:flex-col gap-0.5 p-1.5 sm:p-2 overflow-x-auto sm:overflow-x-visible">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors whitespace-nowrap sm:w-full ${
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-[var(--surface-hover)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Features info - desktop only */}
        <div className="hidden sm:block mt-auto p-3 border-t" style={{ borderColor: 'var(--surface-border)' }}>
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-semibold mb-2">Capabilities</p>
          <div className="space-y-1.5 text-[10px] text-muted-foreground/50">
            <p className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-400/60" /> Code reviews</p>
            <p className="flex items-center gap-1.5"><MessageSquare className="w-3 h-3 text-blue-400/60" /> Telegram bot</p>
            <p className="flex items-center gap-1.5"><Terminal className="w-3 h-3 text-emerald-400/60" /> Terminal AI</p>
            <p className="flex items-center gap-1.5"><BookOpen className="w-3 h-3 text-violet-400/60" /> Long-term memory</p>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {/* Page header */}
        <div className="px-5 sm:px-6 py-4 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <h2 className="text-base font-bold">{activeNav?.label}</h2>
          <p className="text-xs text-muted-foreground/60 mt-0.5">{activeNav?.desc}</p>
        </div>

        <div className="px-5 sm:px-6 py-5">
          {tab === 'providers' && <ProvidersTab />}
          {tab === 'personality' && <PersonalityTab />}
          {tab === 'todos' && <TodosTab />}
          {tab === 'memory' && <MemoryTab />}
          {tab === 'activity' && <ActivityTab />}
          {tab === 'telegram' && <TelegramTab />}
          {tab === 'users' && <UsersTab />}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CHAT TAB
// ══════════════════════════════════════════════════════════════════════════

function ChatTab() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/admin/settings/ai-agent/users').then(({ data }) => {
      setUsers(data.users || []);
      const def = data.users?.find(u => u.is_default) || data.users?.[0];
      if (def) setUserId(def.id);
    }).catch(() => {});
    api.get('/admin/settings/ai-providers').then(({ data }) => {
      setProviders(data.providers || []);
      setSelectedProvider(data.default || '');
    }).catch(() => {});
  }, []);

  const loadHistory = useCallback(() => {
    if (!userId) return;
    api.get(`/admin/settings/ai-agent/conversations/${userId}`).then(({ data }) => {
      setMessages(data.messages || []);
    }).catch(() => {});
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const { data } = await api.post('/admin/settings/ai-agent/chat', {
        message: msg, userId,
        provider: selectedProvider || undefined,
        model: selectedModel || undefined,
      });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        tool_calls: data.toolResults ? JSON.stringify(data.toolResults) : null,
        created_at: new Date().toISOString(),
      }]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to get response');
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.response?.data?.error || err.message}`, created_at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  }

  function handleClear() {
    if (!userId) return;
    api.delete(`/admin/settings/ai-agent/conversations/${userId}`).then(() => {
      setMessages([]);
      toast.success('Conversation cleared');
    }).catch(() => toast.error('Failed to clear'));
  }

  const currentUser = users.find(u => u.id === userId);

  return (
    <div className="space-y-3">
      {/* User selector + actions */}
      <div className="flex items-center gap-2">
        <select
          value={userId || ''}
          onChange={e => setUserId(Number(e.target.value))}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm flex-1"
        >
          <option value="">Select user...</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.is_default ? ' (default)' : ''}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={handleClear} disabled={!userId}>
          <Trash2 className="w-3.5 h-3.5 mr-1" />Clear
        </Button>
      </div>

      {users.length === 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>No users created yet. Go to the <strong>Users</strong> tab to add yourself first.</span>
        </div>
      )}

      {/* Messages */}
      <div className="h-[450px] overflow-y-auto rounded-xl border border-border bg-black/20 p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50">
            <Brain className="w-10 h-10 mb-2" />
            <p className="text-sm">Start a conversation with Bot</p>
            <p className="text-xs mt-1">Try: &quot;Deploy this GitHub repo&quot; or &quot;Show all projects&quot;</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-white rounded-br-sm'
                : 'bg-muted/50 border border-border text-foreground rounded-bl-sm'
            }`}>
              {msg.role === 'assistant' && <span className="text-xs font-semibold text-violet-400 block mb-1">Bot</span>}
              {msg.role === 'user' && currentUser && <span className="text-xs font-semibold text-white/70 block mb-1">{currentUser.name}</span>}
              {msg.content}
              {msg.tool_calls && (() => {
                try {
                  const tools = JSON.parse(msg.tool_calls);
                  if (!tools?.length) return null;
                  return (
                    <div className="mt-2 space-y-1">
                      {tools.map((t, j) => (
                        <div key={j} className="text-[10px] bg-black/20 rounded px-2 py-1 font-mono">
                          <span className="text-emerald-400">{t.tool}</span>
                          {t.result && <span className="text-muted-foreground"> — done</span>}
                          {t.error && <span className="text-red-400"> — {t.error}</span>}
                        </div>
                      ))}
                    </div>
                  );
                } catch { return null; }
              })()}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-xl bg-muted/50 border border-border px-3.5 py-2.5 text-sm rounded-bl-sm">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Provider selector */}
      {providers.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={selectedProvider}
            onChange={e => { setSelectedProvider(e.target.value); setSelectedModel(''); }}
            className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground"
          >
            {providers.filter(p => p.available).map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.costTier})</option>
            ))}
          </select>
          {(() => {
            const p = providers.find(p => p.id === selectedProvider);
            if (!p?.models?.length) return null;
            return (
              <select
                value={selectedModel || p.currentModel}
                onChange={e => setSelectedModel(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground"
              >
                {p.models.map(m => <option key={m} value={m}>{MODEL_INFO[m]?.label || m}</option>)}
              </select>
            );
          })()}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={userId ? "Ask Bot anything..." : "Select a user first..."}
          disabled={!userId || sending}
          className="flex-1"
        />
        <Button onClick={handleSend} disabled={!userId || !input.trim() || sending}>
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PROVIDERS TAB
// ══════════════════════════════════════════════════════════════════════════

const COST_COLORS = {
  free: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  low: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  'low-medium': 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  medium: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  'medium-high': 'text-orange-400 bg-orange-500/10 border-orange-500/20',
};

const PROVIDER_GRADIENTS = {
  'claude-cli': 'from-[#d97706] to-[#b45309]',
  anthropic: 'from-[#d97706] to-[#92400e]',
  openai: 'from-[#10a37f] to-[#0d8a6a]',
  gemini: 'from-[#4285f4] to-[#1a73e8]',
  ollama: 'from-[#52525b] to-[#3f3f46]',
  groq: 'from-[#f55036] to-[#d63a23]',
  mistral: 'from-[#ff7000] to-[#e65c00]',
};

const MODEL_INFO = {
  'claude-sonnet-4-20250514': { label: 'Claude Sonnet 4', desc: 'Best balance of speed and intelligence. Great for most tasks.' },
  'claude-haiku-4-5-20251001': { label: 'Claude Haiku 4.5', desc: 'Fastest Claude model. Best for quick responses and simple tasks.' },
  'claude-opus-4-20250514': { label: 'Claude Opus 4', desc: 'Most powerful Claude. Best for complex reasoning and coding.' },
  'gpt-4o': { label: 'GPT-4o', desc: 'Flagship OpenAI model. Fast, multimodal, great for coding.' },
  'gpt-4o-mini': { label: 'GPT-4o Mini', desc: 'Affordable and fast. Good for simple tasks.' },
  'gpt-4.1': { label: 'GPT-4.1', desc: 'Latest GPT model. Improved coding and instruction following.' },
  'gpt-4.1-mini': { label: 'GPT-4.1 Mini', desc: 'Compact version of GPT-4.1. Cost-effective.' },
  'gpt-4.1-nano': { label: 'GPT-4.1 Nano', desc: 'Smallest GPT-4.1 variant. Ultra-fast, lowest cost.' },
  'o3-mini': { label: 'o3 Mini', desc: 'Reasoning model. Best for math and logic problems.' },
  'gemini-2.5-flash': { label: 'Gemini 2.5 Flash', desc: 'Fast and capable. Good for general tasks at low cost.' },
  'gemini-2.5-pro': { label: 'Gemini 2.5 Pro', desc: 'Most capable Gemini. Great for complex analysis.' },
  'gemini-2.0-flash': { label: 'Gemini 2.0 Flash', desc: 'Previous gen flash model. Very fast responses.' },
  'llama-3.3-70b-versatile': { label: 'Llama 3.3 70B', desc: 'Meta\'s best open model on Groq. Very capable.' },
  'llama-3.1-8b-instant': { label: 'Llama 3.1 8B', desc: 'Small and ultra-fast. Good for quick queries.' },
  'mixtral-8x7b-32768': { label: 'Mixtral 8x7B', desc: 'Mixture of experts model. 32K context window.' },
  'gemma2-9b-it': { label: 'Gemma 2 9B', desc: 'Google\'s open model. Efficient and capable.' },
  'mistral-large-latest': { label: 'Mistral Large', desc: 'Most capable Mistral. Strong at reasoning.' },
  'mistral-medium-latest': { label: 'Mistral Medium', desc: 'Balanced performance and cost.' },
  'mistral-small-latest': { label: 'Mistral Small', desc: 'Fast and affordable for simple tasks.' },
  'codestral-latest': { label: 'Codestral', desc: 'Specialized for code generation and analysis.' },
};

function ProvidersTab() {
  const [providers, setProviders] = useState([]);
  const [defaultId, setDefaultId] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyInputs, setKeyInputs] = useState({});
  const [showKeys, setShowKeys] = useState({});
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});
  const [cliStatus, setCliStatus] = useState(null);
  const [cliChecking, setCliChecking] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [savingKey, setSavingKey] = useState({});

  function load() {
    setLoading(true);
    api.get('/admin/settings/ai-providers').then(({ data }) => {
      setProviders(data.providers || []);
      setDefaultId(data.default || 'claude-cli');
    }).catch(() => {}).finally(() => setLoading(false));
  }

  function checkCli() {
    setCliChecking(true);
    api.get('/admin/settings/ai-providers/claude-cli/status')
      .then(({ data }) => setCliStatus(data))
      .catch(() => setCliStatus({ installed: false }))
      .finally(() => setCliChecking(false));
  }

  useEffect(() => { load(); checkCli(); }, []);

  async function handleSetKey(id) {
    const key = keyInputs[id]?.trim();
    if (!key) return;
    setSavingKey(prev => ({ ...prev, [id]: true }));
    try {
      await api.put(`/admin/settings/ai-providers/${id}`, { apiKey: key });
      setKeyInputs(prev => ({ ...prev, [id]: '' }));
      toast.success(`${id} API key saved`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save key'); }
    finally { setSavingKey(prev => ({ ...prev, [id]: false })); }
  }

  async function handleSetModel(id, model) {
    try {
      await api.put(`/admin/settings/ai-providers/${id}`, { model });
      toast.success('Model updated');
      load();
    } catch { toast.error('Failed to update model'); }
  }

  async function handleSetDefault(id) {
    try {
      await api.put('/admin/settings/ai-providers/default', { provider: id });
      setDefaultId(id);
      toast.success(`Default provider: ${id}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  }

  async function handleTest(id) {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => ({ ...prev, [id]: null }));
    try {
      const { data } = await api.post(`/admin/settings/ai-providers/${id}/test`);
      setTestResults(prev => ({ ...prev, [id]: data }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, error: err.message } }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const cliProvider = providers.find(p => p.id === 'claude-cli');
  const ollamaProvider = providers.find(p => p.id === 'ollama');
  const apiProviders = providers.filter(p => p.id !== 'claude-cli' && p.id !== 'ollama');

  return (
    <div className="space-y-6 max-w-4xl">

      {/* ═══════ AI Agent Features Banner ═══════ */}
      <div className="rounded-xl p-4" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.08) 0%, rgba(59,130,246,0.05) 100%)', border: '1px solid rgba(139,92,246,0.12)' }}>
        <h3 className="text-sm font-semibold mb-3">What can AI Agent do?</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { icon: MessageSquare, label: 'Chat Bot', desc: 'Telegram & web chat', color: 'text-blue-400' },
            { icon: Zap, label: 'Code Reviews', desc: 'PR analysis & feedback', color: 'text-amber-400' },
            { icon: Terminal, label: 'Terminal AI', desc: 'SQL gen, log analysis', color: 'text-emerald-400' },
            { icon: BookOpen, label: 'Memory', desc: 'Learns your context', color: 'text-violet-400' },
          ].map(f => (
            <div key={f.label} className="rounded-lg p-2.5" style={{ background: 'var(--surface-0)' }}>
              <f.icon className={`w-4 h-4 ${f.color} mb-1.5`} />
              <p className="text-[11px] font-medium">{f.label}</p>
              <p className="text-[10px] text-muted-foreground/50">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════ Claude CLI — Hero Card ═══════ */}
      {cliProvider && (() => {
        const p = cliProvider;
        const isDefault = p.id === defaultId;
        const isAuth = cliStatus?.authenticated;
        const isInstalled = cliStatus?.installed;
        return (
          <div className={`rounded-2xl overflow-hidden ${isDefault ? 'ring-1 ring-primary/50' : ''}`}>
            {/* Top gradient banner */}
            <div className="relative px-5 py-4" style={{ background: 'linear-gradient(135deg, rgba(217,119,6,0.15) 0%, rgba(180,83,9,0.05) 100%)' }}>
              <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '20px 20px' }} />
              <div className="relative flex items-start gap-4">
                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#d97706] to-[#92400e] flex items-center justify-center shadow-lg shadow-amber-900/30 shrink-0">
                  <span className="text-white text-xl font-bold">C</span>
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold">Claude Code</h3>
                    {isDefault && <Badge variant="default" className="text-[9px]">default</Badge>}
                    <Badge className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/25">subscription</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Uses your Claude Pro, Max, or Team subscription directly — no API key or per-token costs.
                  </p>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0 pt-1">
                  {!isDefault && (
                    <Button variant="secondary" size="sm" onClick={() => handleSetDefault(p.id)} className="h-8 text-xs">
                      Set Default
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleTest(p.id)} disabled={testing[p.id] || !p.available} className="h-8 text-xs bg-amber-600 hover:bg-amber-500 text-white">
                    {testing[p.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                    Test
                  </Button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="border border-t-0 rounded-b-2xl" style={{ borderColor: 'var(--surface-border)' }}>
              {/* Status row */}
              <div className="px-5 py-3 flex items-center gap-2.5 flex-wrap border-b" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
                {cliChecking ? (
                  <span className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...</span>
                ) : cliStatus ? (
                  <>
                    <StatusPill ok={isInstalled} label={isInstalled ? 'Installed' : 'Not Installed'} />
                    {isInstalled && <StatusPill ok={isAuth} label={isAuth ? 'Authenticated' : 'Not Logged In'} warn={!isAuth} />}
                    {cliStatus.version && <span className="text-[10px] text-muted-foreground/60 font-mono">{cliStatus.version}</span>}
                    <button onClick={checkCli} className="ml-auto p-1 rounded hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors" title="Refresh status">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Status unavailable</span>
                )}
              </div>

              <div className="px-5 py-3.5 space-y-3" style={{ background: 'var(--surface-0)' }}>
                {/* Login CTA */}
                {cliStatus && isInstalled && !isAuth && (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.15)' }}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-400">Login Required</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Run the following command on the server to authenticate with your Claude subscription:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono px-4 py-2.5 rounded-lg text-amber-300 select-all" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        claude login
                      </code>
                    </div>
                    <p className="text-[10px] text-muted-foreground/60">
                      Supports Claude Pro, Max, and Team plans. After login, click the refresh button above.
                    </p>
                  </div>
                )}

                {cliStatus && !isInstalled && (
                  <div className="rounded-xl p-4 space-y-3 bg-red-500/5 border border-red-500/15">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4 text-red-400" />
                      <span className="text-xs font-semibold text-red-400">Claude CLI Not Found</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Install it on the server:</p>
                    <code className="block text-sm font-mono px-4 py-2.5 rounded-lg text-red-300 select-all" style={{ background: 'rgba(0,0,0,0.3)' }}>
                      npm install -g @anthropic-ai/claude-code
                    </code>
                  </div>
                )}

                {/* Model */}
                {p.models.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-muted-foreground shrink-0">Model</label>
                      <select
                        value={p.currentModel || ''}
                        onChange={e => handleSetModel(p.id, e.target.value)}
                        className="h-8 rounded-lg border px-3 text-xs flex-1" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}
                      >
                        {p.models.map(m => <option key={m} value={m}>{MODEL_INFO[m]?.label || m}</option>)}
                      </select>
                    </div>
                    {MODEL_INFO[p.currentModel] && (
                      <p className="text-[10px] text-muted-foreground/50 pl-12">{MODEL_INFO[p.currentModel].desc}</p>
                    )}
                  </div>
                )}

                {testResults[p.id] && <TestResultBanner result={testResults[p.id]} />}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ API Providers ═══════ */}
      <div>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Key className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">API Providers</span>
          <div className="flex-1 h-px" style={{ background: 'var(--surface-border)' }} />
        </div>

        <div className="grid grid-cols-1 gap-2">
          {apiProviders.map(p => {
            const isDefault = p.id === defaultId;
            const isOpen = expanded[p.id];
            const grad = PROVIDER_GRADIENTS[p.id] || 'from-zinc-500 to-zinc-600';

            return (
              <div key={p.id} className={`rounded-xl border overflow-hidden transition-all ${
                isDefault ? 'border-primary/30' : ''
              }`} style={{ borderColor: isDefault ? undefined : 'var(--surface-border)', background: 'var(--surface-0)' }}>
                {/* Header */}
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm`}>
                    {p.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{p.name}</span>
                      {isDefault && <Badge variant="default" className="text-[9px]">default</Badge>}
                      <Badge variant="outline" className={`text-[9px] border ${COST_COLORS[p.costTier] || ''}`}>
                        {p.costTier}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{p.description}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${p.available ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-zinc-600'}`} />
                    <ChevronDown className={`w-4 h-4 text-muted-foreground/40 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}>
                    {/* Actions row */}
                    <div className="flex items-center gap-2 pt-1">
                      {!isDefault && (
                        <Button variant="outline" size="sm" onClick={() => handleSetDefault(p.id)} className="h-7 text-[11px]">
                          <CircleDot className="w-3 h-3 mr-1.5" />Set Default
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => handleTest(p.id)} disabled={testing[p.id] || !p.available} className="h-7 text-[11px]">
                        {testing[p.id] ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <Play className="w-3 h-3 mr-1.5" />}
                        Test Connection
                      </Button>
                    </div>

                    {/* API Key */}
                    {p.requiresKey && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground font-medium">API Key</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              type={showKeys[p.id] ? 'text' : 'password'}
                              value={keyInputs[p.id] || ''}
                              onChange={e => setKeyInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                              placeholder={p.available ? 'Key saved — enter new to replace' : 'Paste your API key here...'}
                              className="h-9 text-xs font-mono pr-9"
                            />
                            <button
                              onClick={() => setShowKeys(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                            >
                              {showKeys[p.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          <Button onClick={() => handleSetKey(p.id)} disabled={!keyInputs[p.id]?.trim() || savingKey[p.id]} className="h-9 text-xs px-4">
                            {savingKey[p.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Save className="w-3.5 h-3.5 mr-1.5" />Save</>}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Model */}
                    {p.models.length > 0 && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-muted-foreground font-medium">Model</label>
                        <select
                          value={p.currentModel || ''}
                          onChange={e => handleSetModel(p.id, e.target.value)}
                          className="w-full h-9 rounded-lg border px-3 text-xs" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-0)' }}
                        >
                          {p.models.map(m => <option key={m} value={m}>{MODEL_INFO[m]?.label || m}</option>)}
                        </select>
                      </div>
                    )}

                    {testResults[p.id] && <TestResultBanner result={testResults[p.id]} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══════ Ollama ═══════ */}
      {ollamaProvider && (() => {
        const p = ollamaProvider;
        const isDefault = p.id === defaultId;
        return (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Cpu className="w-3.5 h-3.5 text-muted-foreground/50" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-semibold">Local Models</span>
              <div className="flex-1 h-px" style={{ background: 'var(--surface-border)' }} />
            </div>

            <div className={`rounded-xl border p-4 space-y-3 ${isDefault ? 'border-primary/30' : ''}`} style={{ borderColor: isDefault ? undefined : 'var(--surface-border)', background: 'var(--surface-0)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-zinc-500 to-zinc-700 flex items-center justify-center text-white text-sm font-bold shadow-sm">O</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">Ollama</span>
                      {isDefault && <Badge variant="default" className="text-[9px]">default</Badge>}
                      <Badge className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">free</Badge>
                      <div className={`w-2 h-2 rounded-full ${p.available ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' : 'bg-zinc-600'}`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">Run open-source LLMs locally — Llama, Mistral, Phi, etc.</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {!isDefault && (
                    <Button variant="outline" size="sm" onClick={() => handleSetDefault(p.id)} className="h-8 text-xs">
                      Set Default
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => handleTest(p.id)} disabled={testing[p.id] || !p.available} className="h-8 text-xs">
                    {testing[p.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                    Test
                  </Button>
                </div>
              </div>

              {p.models.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground shrink-0">Model</label>
                  <select
                    value={p.currentModel || ''}
                    onChange={e => handleSetModel(p.id, e.target.value)}
                    className="h-8 rounded-lg border px-3 text-xs flex-1" style={{ borderColor: 'var(--surface-border)', background: 'var(--surface-1)' }}
                  >
                    {p.models.map(m => <option key={m} value={m}>{MODEL_INFO[m]?.label || m}</option>)}
                  </select>
                </div>
              )}

              {testResults[p.id] && <TestResultBanner result={testResults[p.id]} />}
            </div>
          </div>
        );
      })()}

      {/* ═══════ Terminal Commands ═══════ */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--surface-border)' }}>
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground/60" />
          <span className="text-xs font-semibold text-muted-foreground/80">Terminal AI Commands</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { cmd: 'vpc ai ask <question>', desc: 'Quick AI query' },
            { cmd: 'vpc ai sql <desc>', desc: 'Natural language to SQL' },
            { cmd: 'vpc ai providers', desc: 'List all providers' },
            { cmd: 'vpc ai use <provider>', desc: 'Switch default' },
          ].map(c => (
            <div key={c.cmd} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-0)' }}>
              <code className="text-[10px] font-mono text-primary/70 whitespace-nowrap">{c.cmd}</code>
              <span className="text-[10px] text-muted-foreground/40 ml-auto">{c.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ ok, label, warn }) {
  const color = ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : warn ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20';
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

function TestResultBanner({ result }) {
  return (
    <div className={`flex items-start gap-2.5 p-3 rounded-xl text-xs ${
      result.ok ? 'bg-emerald-500/5 border border-emerald-500/15' : 'bg-red-500/5 border border-red-500/15'
    }`}>
      {result.ok ? (
        <>
          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <span className="text-emerald-400 font-semibold">{result.latency}ms</span>
            <p className="text-muted-foreground/70 text-[11px] mt-0.5">{result.response?.slice(0, 120)}</p>
          </div>
        </>
      ) : (
        <>
          <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <span className="text-red-400">{result.error}</span>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TODOS TAB
// ══════════════════════════════════════════════════════════════════════════

const PRIORITY_COLORS = { urgent: 'text-red-400 bg-red-500/10', high: 'text-orange-400 bg-orange-500/10', normal: 'text-blue-400 bg-blue-500/10', low: 'text-zinc-400 bg-zinc-500/10' };
const STATUS_COLORS = { pending: 'text-zinc-400', in_progress: 'text-amber-400', done: 'text-emerald-400', blocked: 'text-red-400' };

function TodosTab() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  function load() {
    setLoading(true);
    const url = filter ? `/admin/settings/ai-agent/todos?status=${filter}` : '/admin/settings/ai-agent/todos';
    api.get(url).then(({ data }) => setTodos(data.todos || [])).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filter]);

  async function handleAdd() {
    if (!newTitle.trim()) return;
    try {
      await api.post('/admin/settings/ai-agent/todos', { title: newTitle.trim(), priority: newPriority, assignedBy: 'User', assignedTo: 'Bot' });
      setNewTitle('');
      toast.success('Todo added');
      load();
    } catch { toast.error('Failed'); }
  }

  async function handleStatus(id, status) {
    try {
      await api.put(`/admin/settings/ai-agent/todos/${id}`, { status });
      load();
    } catch { toast.error('Failed'); }
  }

  async function handleDelete(id) {
    try { await api.delete(`/admin/settings/ai-agent/todos/${id}`); load(); } catch { toast.error('Failed'); }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Tasks tracked by the Bot. You can assign tasks here or the Bot creates them automatically during conversations.</p>

      {/* Add todo */}
      <div className="flex gap-2">
        <select value={newPriority} onChange={e => setNewPriority(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-xs w-24">
          {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Add a task for Bot..." className="flex-1" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <Button size="sm" onClick={handleAdd} disabled={!newTitle.trim()}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {['', 'pending', 'in_progress', 'done', 'blocked'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${filter === s ? 'bg-primary/20 text-primary' : 'text-muted-foreground/40 hover:bg-muted/50'}`}
          >{s || 'All'}</button>
        ))}
      </div>

      {/* List */}
      {loading ? <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" /></div> : todos.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          <ListTodo className="w-8 h-8 mx-auto mb-2 opacity-30" />No tasks yet
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {todos.map(t => (
            <div key={t.id} className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-[9px] ${PRIORITY_COLORS[t.priority]}`}>{t.priority}</Badge>
                  <span className={`text-[9px] font-medium ${STATUS_COLORS[t.status]}`}>{t.status}</span>
                </div>
                <p className={`text-sm mt-0.5 ${t.status === 'done' ? 'line-through text-muted-foreground/40' : ''}`}>{t.title}</p>
                {t.description && <p className="text-[10px] text-muted-foreground mt-0.5">{t.description}</p>}
                <div className="flex gap-2 mt-1 text-[9px] text-muted-foreground/40">
                  {t.assigned_to && <span>Assigned: {t.assigned_to}</span>}
                  {t.due_date && <span>Due: {new Date(t.due_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                {t.status === 'pending' && <button onClick={() => handleStatus(t.id, 'in_progress')} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20">Start</button>}
                {t.status === 'in_progress' && <button onClick={() => handleStatus(t.id, 'done')} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20">Done</button>}
                {t.status !== 'done' && <button onClick={() => handleStatus(t.id, 'blocked')} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">Block</button>}
                <button onClick={() => handleDelete(t.id)} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground hover:bg-muted"><Trash2 className="w-2.5 h-2.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVITY TAB
// ══════════════════════════════════════════════════════════════════════════

function ActivityTab() {
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/settings/ai-agent/activity').then(({ data }) => setActivity(data.activity || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Recent Bot actions — tool executions, deployments, queries, and alerts.</p>

      {activity.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />No activity yet. The Bot logs actions here when it uses tools.
        </div>
      ) : (
        <div className="space-y-2 max-h-[450px] overflow-y-auto">
          {activity.map(a => {
            let tools = [];
            try { tools = JSON.parse(a.tool_calls) || []; } catch {}
            return (
              <div key={a.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground/40">{a.user_name || 'System'}</span>
                  <span className="text-[9px] text-muted-foreground/30">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="text-xs text-foreground/80 line-clamp-2">{(a.content || '').slice(0, 200)}</p>
                {tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tools.map((t, i) => (
                      <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${t.error ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                        {t.tool}{t.error ? ' ✗' : ' ✓'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// TELEGRAM TAB
// ══════════════════════════════════════════════════════════════════════════

function TelegramTab() {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState({});

  useEffect(() => {
    api.get('/admin/settings/telegram/config').then(({ data }) => {
      setConfig(data);
      setNotifications(data.notifications || {});
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSaveToken() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      await api.put('/admin/settings/telegram/config', { bot_token: token.trim() });
      setToken('');
      toast.success('Bot token saved. Reloading...');
      await api.post('/admin/settings/ai-agent/telegram/reload');
      const { data } = await api.get('/admin/settings/telegram/config');
      setConfig(data);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  }

  async function handleSaveNotifications() {
    try {
      await api.put('/admin/settings/telegram/config', { notifications });
      toast.success('Notification preferences saved');
    } catch { toast.error('Failed'); }
  }

  async function handleRemoveToken() {
    try {
      await api.delete('/admin/settings/telegram/config');
      setConfig({});
      toast.success('Bot token removed');
    } catch { toast.error('Failed'); }
  }

  const NOTIF_OPTIONS = [
    { key: 'pr_created', label: 'PR Created' },
    { key: 'pr_merged', label: 'PR Merged' },
    { key: 'pr_conflict', label: 'Merge Conflicts' },
    { key: 'system_alerts', label: 'System Alerts (deploy, backup, crashes)' },
  ];

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Connect a Telegram bot so VPC Bot can chat and send alerts via Telegram.</p>

      {/* Bot Token */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <Label className="text-xs font-medium">Bot Token</Label>
        {config.bot_token_set ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-8 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 flex items-center text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mr-2" />
              <span className="text-emerald-400 font-mono">{config.bot_token_mask}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleRemoveToken} className="h-8 text-xs text-red-400 hover:text-red-300">Remove</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste your Telegram bot token..." className="h-8 text-xs font-mono" />
            <Button size="sm" onClick={handleSaveToken} disabled={!token.trim() || saving} className="h-8 text-xs">
              {saving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}Save
            </Button>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">Get a token from <strong>@BotFather</strong> on Telegram. Create a bot, copy the token, paste here.</p>
      </div>

      {/* Notification Preferences */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <Label className="text-xs font-medium">Alert Notifications</Label>
        <p className="text-[10px] text-muted-foreground mb-2">Choose which events trigger Telegram alerts.</p>
        {NOTIF_OPTIONS.map(opt => (
          <label key={opt.key} className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={notifications[opt.key] !== false}
              onChange={e => setNotifications(prev => ({ ...prev, [opt.key]: e.target.checked }))}
              className="rounded border-border"
            />
            {opt.label}
          </label>
        ))}
        <Button size="sm" onClick={handleSaveNotifications} className="mt-2 h-7 text-[10px]">
          <Save className="w-3 h-3 mr-1" />Save Preferences
        </Button>
      </div>

      {/* Setup Guide */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-blue-400">Setup Guide</p>
        <p>1. Message <strong>@BotFather</strong> on Telegram → /newbot → get token</p>
        <p>2. Paste token above → Bot connects automatically</p>
        <p>3. Each user needs their Chat ID linked (Users tab)</p>
        <p>4. Send <code>/start</code> to your bot to get your Chat ID</p>
        <p>5. Bot responds to messages with full AI + tools + alerts</p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PERSONALITY TAB
// ══════════════════════════════════════════════════════════════════════════

function PersonalityTab() {
  const [personality, setPersonality] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.get('/admin/settings/ai-agent/personality').then(({ data }) => {
      setPersonality(data.personality || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/admin/settings/ai-agent/personality', { personality });
      toast.success('Personality saved');
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/admin/settings/ai-agent/test');
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally { setTesting(false); }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-sm font-medium">System Personality</Label>
        <p className="text-xs text-muted-foreground mb-2">Define how Bot behaves. This is the system prompt sent with every message.</p>
        <textarea
          value={personality}
          onChange={e => setPersonality(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <p className="text-[10px] text-muted-foreground mt-1">{personality.length} characters</p>
      </div>

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
          Save Personality
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Terminal className="w-4 h-4 mr-1.5" />}
          Test CLI Connection
        </Button>
      </div>

      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-lg border ${testResult.success ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
          {testResult.success
            ? <><CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" /><div><p className="text-xs font-medium text-emerald-400">{testResult.message}</p>{testResult.response && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{testResult.response}</p>}</div></>
            : <><XCircle className="w-4 h-4 text-red-400 mt-0.5" /><p className="text-xs text-red-400">{testResult.error}</p></>
          }
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// MEMORY TAB
// ══════════════════════════════════════════════════════════════════════════

function MemoryTab() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newFact, setNewFact] = useState('');
  const [newCategory, setNewCategory] = useState('general');

  useEffect(() => {
    api.get('/admin/settings/ai-agent/users').then(({ data }) => {
      setUsers(data.users || []);
      const def = data.users?.find(u => u.is_default) || data.users?.[0];
      if (def) setUserId(def.id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    api.get(`/admin/settings/ai-agent/users/${userId}/memory`).then(({ data }) => {
      setMemories(data.memories || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [userId]);

  async function handleAdd() {
    if (!newFact.trim() || !userId) return;
    try {
      const { data } = await api.post(`/admin/settings/ai-agent/users/${userId}/memory`, { fact: newFact.trim(), category: newCategory });
      setMemories(prev => [data, ...prev]);
      setNewFact('');
      toast.success('Memory added');
    } catch { toast.error('Failed to add'); }
  }

  async function handleDelete(memId) {
    try {
      await api.delete(`/admin/settings/ai-agent/memory/${memId}`);
      setMemories(prev => prev.filter(m => m.id !== memId));
    } catch { toast.error('Failed to delete'); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={userId || ''} onChange={e => setUserId(Number(e.target.value))} className="h-9 rounded-lg border border-border bg-background px-3 text-sm flex-1">
          <option value="">Select user...</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {/* Add memory */}
      <div className="flex gap-2">
        <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-xs w-28">
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <Input value={newFact} onChange={e => setNewFact(e.target.value)} placeholder="Add a fact Bot should remember..." className="flex-1" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
        <Button size="sm" onClick={handleAdd} disabled={!userId || !newFact.trim()}>
          <Plus className="w-3.5 h-3.5 mr-1" />Add
        </Button>
      </div>

      {/* Memory list */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : memories.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No memories yet. Add facts or let Bot learn automatically during conversations.
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {memories.map(m => (
            <div key={m.id} className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm">{m.fact}</p>
                <div className="flex gap-1.5 mt-1">
                  <Badge variant="outline" className="text-[10px]">{m.category}</Badge>
                  {m.source === 'auto' && <Badge variant="secondary" className="text-[10px]">auto-learned</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)} className="shrink-0 h-7 w-7 p-0">
                <Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-400" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// USERS TAB
// ══════════════════════════════════════════════════════════════════════════

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [greeting, setGreeting] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  useEffect(() => { loadUsers(); }, []);

  function loadUsers() {
    setLoading(true);
    api.get('/admin/settings/ai-agent/users').then(({ data }) => {
      setUsers(data.users || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }

  async function handleAdd() {
    if (!name.trim()) return;
    try {
      await api.post('/admin/settings/ai-agent/users', {
        name: name.trim(),
        displayName: displayName.trim() || name.trim(),
        greeting: greeting.trim(),
        telegramChatId: telegramChatId.trim() || null,
        isDefault: users.length === 0,
      });
      setName(''); setDisplayName(''); setGreeting(''); setTelegramChatId('');
      loadUsers();
      toast.success('User added');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add');
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/admin/settings/ai-agent/users/${id}`);
      loadUsers();
    } catch { toast.error('Failed to delete'); }
  }

  async function handleSetDefault(id) {
    try {
      await api.put(`/admin/settings/ai-agent/users/${id}`, { isDefault: true });
      loadUsers();
    } catch { toast.error('Failed to update'); }
  }

  async function handleUpdateTelegram(id, chatId) {
    try {
      await api.put(`/admin/settings/ai-agent/users/${id}`, { telegramChatId: chatId });
      loadUsers();
      toast.success('Telegram ID updated');
    } catch { toast.error('Failed to update'); }
  }

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Users that interact with Bot. Each user can link their Telegram to chat with Bot remotely. Memory is shared across all users.</p>

      {/* Add user form */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Yash" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Display Name</Label>
            <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Yash Patil" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Greeting</Label>
            <Input value={greeting} onChange={e => setGreeting(e.target.value)} placeholder="e.g. Hey boss!" className="h-8 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Telegram Chat ID</Label>
            <Input value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)} placeholder="e.g. 123456789" className="h-8 text-sm font-mono" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleAdd} disabled={!name.trim()}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add User
          </Button>
          <span className="text-[10px] text-muted-foreground">Send /start to your Telegram bot to get your Chat ID</span>
        </div>
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          <User className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No users yet. Add yourself to start chatting with Bot.
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{u.name}</p>
                  {u.is_default && <Badge variant="default" className="text-[10px]">default</Badge>}
                  {u.telegram_chat_id && <Badge variant="outline" className="text-[10px] font-mono">TG: {u.telegram_chat_id}</Badge>}
                </div>
                {u.display_name && u.display_name !== u.name && <p className="text-xs text-muted-foreground">{u.display_name}</p>}
                {u.greeting && <p className="text-xs text-muted-foreground italic">&quot;{u.greeting}&quot;</p>}
              </div>
              <div className="flex gap-1">
                {!u.telegram_chat_id && (
                  <Button variant="outline" size="sm" onClick={() => {
                    const id = prompt('Enter Telegram Chat ID:');
                    if (id) handleUpdateTelegram(u.id, id);
                  }} title="Link Telegram" className="h-8 text-[10px] px-2">
                    <Send className="w-3 h-3 mr-1" />TG
                  </Button>
                )}
                {!u.is_default && (
                  <Button variant="ghost" size="sm" onClick={() => handleSetDefault(u.id)} title="Set as default" className="h-8 w-8 p-0">
                    <Star className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => handleDelete(u.id)} className="h-8 w-8 p-0">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Telegram Bot Setup Info */}
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-blue-400">Telegram Setup</p>
        <p>1. The Telegram bot token is configured in VPC Settings → Telegram tab</p>
        <p>2. Each user needs their own Telegram Chat ID linked above</p>
        <p>3. Send <code>/start</code> to your bot on Telegram — it will show your Chat ID</p>
        <p>4. Bot will respond to messages on Telegram with full AI + automation powers</p>
        <p>5. Bot can also send proactive alerts to all linked users</p>
      </div>
    </div>
  );
}
