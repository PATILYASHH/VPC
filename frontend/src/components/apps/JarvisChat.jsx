import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Brain, Send, Loader2, Trash2, Settings, AlertTriangle,
  Cpu, Wifi, WifiOff, ChevronDown, Sparkles, Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

const QUICK_ACTIONS = [
  { label: 'Show all projects', msg: 'List all projects' },
  { label: 'Server status', msg: 'What is the server status? Show disk, memory, uptime.' },
  { label: 'Active todos', msg: 'Show my active todos' },
  { label: 'Recent deploys', msg: 'What were the recent deployments?' },
];

export default function JarvisChat() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [providers, setProviders] = useState([]);
  const [defaultProvider, setDefaultProvider] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showProviderBar, setShowProviderBar] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        let { data } = await api.get('/admin/settings/ai-agent/users');
        let list = data.users || [];
        // Auto-create a default user on first run so chat is immediately usable
        if (list.length === 0) {
          try {
            const { data: created } = await api.post('/admin/settings/ai-agent/users', {
              name: 'You',
              displayName: 'You',
              greeting: '',
              isDefault: true,
            });
            list = [created];
          } catch (e) {
            console.error('[JarvisChat] Auto-create user failed:', e.message);
          }
        }
        setUsers(list);
        const def = list.find(u => u.is_default) || list[0];
        if (def) setUserId(def.id);
      } catch (err) {
        console.error('[JarvisChat] Failed to load users:', err.message);
      }
    })();
    api.get('/admin/settings/ai-providers').then(({ data }) => {
      setProviders(data.providers || []);
      setDefaultProvider(data.default || '');
      setSelectedProvider(data.default || '');
    }).catch((err) => {
      console.error('[JarvisChat] Failed to load providers:', err.message);
    });
  }, []);

  const loadHistory = useCallback(() => {
    if (!userId) return;
    api.get(`/admin/settings/ai-agent/conversations/${userId}`).then(({ data }) => {
      setMessages(data.messages || []);
    }).catch((err) => {
      console.error('[JarvisChat] Failed to load history:', err.message);
    });
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function handleSend(text) {
    const msg = (text || input).trim();
    if (!msg || sending) return;
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
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.response?.data?.error || err.message}`,
        created_at: new Date().toISOString(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
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
  const activeProvider = providers.find(p => p.id === selectedProvider);
  const availableProviders = providers.filter(p => p.available);
  const hasAnyProvider = availableProviders.length > 0;

  // ─── No AI Provider Available ────────────────────────────────
  if (providers.length > 0 && !hasAnyProvider) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
          <WifiOff className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-lg font-bold mb-2">No AI Provider Active</h2>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Bot needs at least one AI provider to work. Set up an API key or install Ollama / Claude CLI.
        </p>
        <div className="space-y-2 text-xs text-muted-foreground/60">
          <p><strong>Option 1:</strong> Install Claude CLI on your server (free)</p>
          <p><strong>Option 2:</strong> Add an API key in AI Agent Settings → Providers</p>
          <p><strong>Option 3:</strong> Install Ollama from VPC Store (free, local)</p>
        </div>
      </div>
    );
  }

  // ─── No Users Created ────────────────────────────────────────
  if (users.length > 0 && !userId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Brain className="w-12 h-12 text-violet-400 mb-4" />
        <h2 className="text-lg font-bold mb-2">Select a User</h2>
        <p className="text-sm text-muted-foreground mb-4">Choose who's chatting with Bot</p>
        <div className="space-y-2">
          {users.map(u => (
            <button key={u.id} onClick={() => setUserId(u.id)}
              className="block w-full px-4 py-2 rounded-lg border border-border hover:bg-muted/50 text-sm text-left"
            >
              {u.name} {u.is_default && <Badge variant="outline" className="text-[9px] ml-1">default</Badge>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">VPC Bot</span>
              {hasAnyProvider && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </div>
            <button
              onClick={() => setShowProviderBar(!showProviderBar)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {activeProvider ? `${activeProvider.name} · ${activeProvider.currentModel}` : 'No provider'}
              <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showProviderBar ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {users.length > 1 && (
            <select
              value={userId || ''}
              onChange={e => setUserId(Number(e.target.value))}
              className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-muted-foreground"
            >
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <Button variant="ghost" size="sm" onClick={handleClear} className="h-7 w-7 p-0" title="Clear chat">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ─── Provider Selector Bar ─── */}
      {showProviderBar && (
        <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 overflow-x-auto shrink-0">
          {availableProviders.map(p => (
            <button
              key={p.id}
              onClick={() => { setSelectedProvider(p.id); setSelectedModel(''); setShowProviderBar(false); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all whitespace-nowrap ${
                selectedProvider === p.id
                  ? 'bg-primary/20 text-primary border border-primary/30'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
              }`}
            >
              <Wifi className="w-3 h-3" />
              {p.name}
              <span className="text-[9px] opacity-50">({p.costTier})</span>
            </button>
          ))}
          {activeProvider?.models?.length > 1 && (
            <select
              value={selectedModel || activeProvider.currentModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="h-7 rounded-full border border-border bg-background px-2 text-[10px] ml-auto"
            >
              {activeProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
      )}

      {/* ─── Messages ─── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-base font-semibold mb-1">Hey{currentUser ? `, ${currentUser.name}` : ''}!</h3>
            <p className="text-xs text-muted-foreground mb-6">What can I help you with?</p>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              {QUICK_ACTIONS.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(qa.msg)}
                  className="px-3 py-2 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 text-[11px] text-left transition-colors"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-white rounded-br-sm'
                : 'bg-muted/50 border border-border text-foreground rounded-bl-sm'
            }`}>
              {msg.role === 'assistant' && (
                <span className="text-[10px] font-semibold text-violet-400 block mb-1">Bot</span>
              )}
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
            <div className="rounded-xl bg-muted/50 border border-border px-3.5 py-2.5 text-sm rounded-bl-sm flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              <span className="text-xs text-muted-foreground">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ─── Input ─── */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask Bot anything..."
            disabled={sending}
            className="flex-1 h-10 rounded-xl border border-border bg-muted/30 px-4 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all"
          />
          <Button onClick={() => handleSend()} disabled={!input.trim() || sending} className="h-10 w-10 p-0 rounded-xl">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[9px] text-muted-foreground/30">
            {activeProvider ? `${activeProvider.name} · ${selectedModel || activeProvider.currentModel}` : ''}
          </span>
          <span className="text-[9px] text-muted-foreground/30">
            Enter to send
          </span>
        </div>
      </div>
    </div>
  );
}
