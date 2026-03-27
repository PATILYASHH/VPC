import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Brain, MessageSquare, User, BookOpen, Send, Loader2, Trash2, Plus, Save,
  CheckCircle2, XCircle, RefreshCw, AlertTriangle, Settings, Bell, Zap,
  Terminal, Star, StarOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import api from '@/lib/api';

const CATEGORIES = ['general', 'preference', 'project', 'technical'];

export default function AgentSettings() {
  const [tab, setTab] = useState('personality');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-lg shadow-violet-500/20">
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Jarvis AI Agent</h2>
          <p className="text-xs text-muted-foreground">Your AI assistant — powered by Claude CLI on this server</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="personality"><Brain className="w-3.5 h-3.5 mr-1.5" />Personality</TabsTrigger>
          <TabsTrigger value="memory"><BookOpen className="w-3.5 h-3.5 mr-1.5" />Memory</TabsTrigger>
          <TabsTrigger value="users"><User className="w-3.5 h-3.5 mr-1.5" />Users</TabsTrigger>
        </TabsList>

        <TabsContent value="personality"><PersonalityTab /></TabsContent>
        <TabsContent value="memory"><MemoryTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
      </Tabs>
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
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get('/admin/settings/ai-agent/users').then(({ data }) => {
      setUsers(data.users || []);
      const def = data.users?.find(u => u.is_default) || data.users?.[0];
      if (def) setUserId(def.id);
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
      const { data } = await api.post('/admin/settings/ai-agent/chat', { message: msg, userId });
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
            <p className="text-sm">Start a conversation with Jarvis</p>
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
              {msg.role === 'assistant' && <span className="text-xs font-semibold text-violet-400 block mb-1">Jarvis</span>}
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

      {/* Input */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={userId ? "Ask Jarvis anything..." : "Select a user first..."}
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
        <p className="text-xs text-muted-foreground mb-2">Define how Jarvis behaves. This is the system prompt sent with every message.</p>
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
        <Input value={newFact} onChange={e => setNewFact(e.target.value)} placeholder="Add a fact Jarvis should remember..." className="flex-1" onKeyDown={e => e.key === 'Enter' && handleAdd()} />
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
          No memories yet. Add facts or let Jarvis learn automatically during conversations.
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
      <p className="text-xs text-muted-foreground">Users that interact with Jarvis. Each user can link their Telegram to chat with Jarvis remotely. Memory is shared across all users.</p>

      {/* Add user form */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
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
          No users yet. Add yourself to start chatting with Jarvis.
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
        <p>4. Jarvis will respond to messages on Telegram with full AI + automation powers</p>
        <p>5. Jarvis can also send proactive alerts to all linked users</p>
      </div>
    </div>
  );
}
