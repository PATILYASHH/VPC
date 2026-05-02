import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Brain, Send, Loader2, Trash2, AlertTriangle,
  Wifi, WifiOff, ChevronDown, Sparkles, Bot,
  Eye, PenLine, FolderTree, Globe, Database, GitBranch,
  Check, X, Download, FileText, FileSpreadsheet, FileCode2, File,
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

const DEFAULT_SETTINGS = {
  mode: 'read_write',
  scope_enabled: false,
  allowed_hosting_ids: null,
  allowed_db_ids: null,
  allowed_repo_ids: null,
};

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
  const [chatSettings, setChatSettings] = useState(DEFAULT_SETTINGS);
  const [showScope, setShowScope] = useState(false);
  const [scopeResources, setScopeResources] = useState({ hosting: [], databases: [], repos: [] });
  const [approving, setApproving] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        let { data } = await api.get('/admin/settings/ai-agent/users');
        let list = data.users || [];
        if (list.length === 0) {
          try {
            const { data: created } = await api.post('/admin/settings/ai-agent/users', {
              name: 'You', displayName: 'You', greeting: '', isDefault: true,
            });
            list = [created];
          } catch (e) { console.error('[JarvisChat] Auto-create user failed:', e.message); }
        }
        setUsers(list);
        const def = list.find(u => u.is_default) || list[0];
        if (def) setUserId(def.id);
      } catch (err) { console.error('[JarvisChat] Failed to load users:', err.message); }
    })();
    api.get('/admin/settings/ai-providers').then(({ data }) => {
      setProviders(data.providers || []);
      setDefaultProvider(data.default || '');
      setSelectedProvider(data.default || '');
    }).catch((err) => { console.error('[JarvisChat] Failed to load providers:', err.message); });
    api.get('/admin/settings/ai-agent/scope-resources').then(({ data }) => {
      setScopeResources({ hosting: data.hosting || [], databases: data.databases || [], repos: data.repos || [] });
    }).catch(() => {});
  }, []);

  // Load chat settings + history when user changes
  useEffect(() => {
    if (!userId) return;
    api.get(`/admin/settings/ai-agent/chat-settings/${userId}`)
      .then(({ data }) => setChatSettings({ ...DEFAULT_SETTINGS, ...data }))
      .catch(() => setChatSettings(DEFAULT_SETTINGS));
  }, [userId]);

  const loadHistory = useCallback(() => {
    if (!userId) return;
    api.get(`/admin/settings/ai-agent/conversations/${userId}`).then(({ data }) => {
      setMessages(data.messages || []);
    }).catch((err) => { console.error('[JarvisChat] Failed to load history:', err.message); });
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function saveSettings(patch) {
    const next = { ...chatSettings, ...patch };
    setChatSettings(next);
    if (!userId) return;
    try {
      await api.put(`/admin/settings/ai-agent/chat-settings/${userId}`, next);
    } catch (err) { toast.error('Failed to save settings'); }
  }

  async function toggleMode() {
    const next = chatSettings.mode === 'read' ? 'read_write' : 'read';
    await saveSettings({ mode: next });
    toast.success(next === 'read' ? 'Switched to Read mode — Bot can only read' : 'Switched to Read & Write mode');
  }

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

  async function handleApproval(msgIdx, toolIdx, decision) {
    const msg = messages[msgIdx];
    if (!msg?.tool_calls) return;
    let tools;
    try { tools = JSON.parse(msg.tool_calls); } catch { return; }
    const t = tools[toolIdx];
    if (!t?.result?.needs_approval) return;
    const key = `${msgIdx}-${toolIdx}`;
    setApproving(p => ({ ...p, [key]: decision }));
    try {
      const { data } = await api.post('/admin/settings/ai-agent/approve', {
        userId,
        tool: t.result.action || t.tool,
        params: t.params,
        decision,
      });
      // Replace the pending tool result so the UI stops showing the approval block
      tools[toolIdx] = {
        ...t,
        result: decision === 'deny'
          ? { denied: true }
          : (data?.result || { ok: true }),
      };
      const updated = [...messages];
      updated[msgIdx] = { ...msg, tool_calls: JSON.stringify(tools) };
      setMessages(updated);
      // Append a follow-up assistant note for visibility
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: decision === 'deny' ? 'Action denied. I won\'t run it.' : `Action approved and executed.`,
        tool_calls: decision === 'approve' ? JSON.stringify([{ tool: t.result.action || t.tool, params: t.params, result: data?.result }]) : null,
        created_at: new Date().toISOString(),
      }]);
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally {
      setApproving(p => ({ ...p, [key]: null }));
    }
  }

  const currentUser = users.find(u => u.id === userId);
  const activeProvider = providers.find(p => p.id === selectedProvider);
  const availableProviders = providers.filter(p => p.available);
  const hasAnyProvider = availableProviders.length > 0;
  const isReadMode = chatSettings.mode === 'read';

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
      </div>
    );
  }

  if (users.length > 0 && !userId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <Brain className="w-12 h-12 text-violet-400 mb-4" />
        <h2 className="text-lg font-bold mb-2">Select a User</h2>
        <div className="space-y-2">
          {users.map(u => (
            <button key={u.id} onClick={() => setUserId(u.id)}
              className="block w-full px-4 py-2 rounded-lg border border-border hover:bg-muted/50 text-sm text-left">
              {u.name} {u.is_default && <Badge variant="outline" className="text-[9px] ml-1">default</Badge>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
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
            {/* Mode toggle */}
            <button
              onClick={toggleMode}
              title={isReadMode ? 'Click to switch to Read & Write' : 'Click to switch to Read-only'}
              className={`flex items-center gap-1 h-7 px-2.5 rounded-full text-[10px] font-semibold transition-all border ${
                isReadMode
                  ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              }`}
            >
              {isReadMode ? <Eye className="w-3 h-3" /> : <PenLine className="w-3 h-3" />}
              {isReadMode ? 'Read' : 'Read & Write'}
            </button>
            {/* Scope toggle */}
            <button
              onClick={() => setShowScope(!showScope)}
              title="Allocate projects to this chat"
              className={`flex items-center gap-1 h-7 px-2.5 rounded-full text-[10px] font-semibold transition-all border ${
                chatSettings.scope_enabled
                  ? 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                  : 'bg-muted/40 text-muted-foreground border-border'
              }`}
            >
              <FolderTree className="w-3 h-3" />
              Scope{chatSettings.scope_enabled ? ' on' : ''}
            </button>
            {users.length > 1 && (
              <select value={userId || ''} onChange={e => setUserId(Number(e.target.value))}
                className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-muted-foreground">
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
              <button key={p.id}
                onClick={() => { setSelectedProvider(p.id); setSelectedModel(''); setShowProviderBar(false); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all whitespace-nowrap ${
                  selectedProvider === p.id ? 'bg-primary/20 text-primary border border-primary/30'
                                             : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                }`}>
                <Wifi className="w-3 h-3" />{p.name}<span className="text-[9px] opacity-50">({p.costTier})</span>
              </button>
            ))}
            {activeProvider?.models?.length > 1 && (
              <select value={selectedModel || activeProvider.currentModel} onChange={e => setSelectedModel(e.target.value)}
                className="h-7 rounded-full border border-border bg-background px-2 text-[10px] ml-auto">
                {activeProvider.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
        )}

        {/* ─── Mode banner ─── */}
        {isReadMode && (
          <div className="px-4 py-1.5 bg-sky-500/[0.06] border-b border-sky-500/15 text-[10px] text-sky-400 flex items-center gap-1.5 shrink-0">
            <Eye className="w-3 h-3" />
            Read-only mode — Bot can inspect data but won't deploy, write files, or run mutating SQL.
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
                  <button key={i} onClick={() => handleSend(qa.msg)}
                    className="px-3 py-2 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 text-[11px] text-left transition-colors">
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === 'user' ? 'bg-primary text-white rounded-br-sm'
                                    : 'bg-muted/50 border border-border text-foreground rounded-bl-sm'
              }`}>
                {msg.role === 'assistant' && (
                  <span className="text-[10px] font-semibold text-violet-400 block mb-1">Bot</span>
                )}
                {msg.content}
                {msg.tool_calls && (() => {
                  let tools;
                  try { tools = JSON.parse(msg.tool_calls); } catch { return null; }
                  if (!tools?.length) return null;
                  return (
                    <div className="mt-2 space-y-2">
                      {tools.map((t, j) => (
                        <ToolBlock
                          key={j}
                          tool={t}
                          pending={approving[`${i}-${j}`]}
                          onApprove={() => handleApproval(i, j, 'approve')}
                          onDeny={() => handleApproval(i, j, 'deny')}
                        />
                      ))}
                    </div>
                  );
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
            <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder={isReadMode ? 'Ask Bot to read or analyze something...' : 'Ask Bot anything...'}
              disabled={sending}
              className="flex-1 h-10 rounded-xl border border-border bg-muted/30 px-4 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all" />
            <Button onClick={() => handleSend()} disabled={!input.trim() || sending} className="h-10 w-10 p-0 rounded-xl">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[9px] text-muted-foreground/30">
              {activeProvider ? `${activeProvider.name} · ${selectedModel || activeProvider.currentModel}` : ''}
            </span>
            <span className="text-[9px] text-muted-foreground/30">Enter to send</span>
          </div>
        </div>
      </div>

      {/* Scope panel */}
      {showScope && (
        <ScopePanel
          settings={chatSettings}
          resources={scopeResources}
          onChange={saveSettings}
          onClose={() => setShowScope(false)}
        />
      )}
    </div>
  );
}

// ─── Tool result block (with inline approval) ─────────────────────────────

function ToolBlock({ tool, pending, onApprove, onDeny }) {
  const r = tool.result || {};

  if (r.needs_approval) {
    const detail =
      r.action === 'write_file' ? `Write file: ${r.path}\n\nPreview:\n${r.preview || ''}` :
      r.action === 'edit_file'  ? `Edit file: ${r.path}\nFind: ${r.find}\nReplace: ${r.replace}` :
      r.action === 'run_script' ? `Run command:\n${r.command}` :
      `Action: ${r.action}`;
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
            Permission needed · {r.action}
          </span>
        </div>
        <pre className="text-[10px] text-muted-foreground/80 whitespace-pre-wrap font-mono bg-black/20 rounded p-2 max-h-48 overflow-auto">{detail}</pre>
        <div className="flex gap-1.5 mt-2">
          <Button size="sm" onClick={onApprove} disabled={!!pending}
            className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white">
            {pending === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={onDeny} disabled={!!pending}
            className="h-7 text-[10px] gap-1">
            {pending === 'deny' ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
            Deny
          </Button>
        </div>
      </div>
    );
  }

  if (r.document) {
    const Icon = ({ pdf: FileText, xlsx: FileSpreadsheet, csv: FileSpreadsheet, html: FileCode2, md: FileCode2 })[r.document.format] || File;
    return (
      <a href={r.document.download_url} target="_blank" rel="noopener noreferrer" download
         className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10 p-2.5 transition-colors">
        <Icon className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold truncate">{r.document.title || r.document.filename}</div>
          <div className="text-[9px] text-muted-foreground/60 font-mono truncate">
            {r.document.filename} · {(r.document.byte_size / 1024).toFixed(1)} KB
          </div>
        </div>
        <Download className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      </a>
    );
  }

  return (
    <div className="text-[10px] bg-black/20 rounded px-2 py-1 font-mono">
      <span className="text-emerald-400">{tool.tool}</span>
      {r && !r.error && <span className="text-muted-foreground"> — done</span>}
      {r?.error && <span className="text-red-400"> — {r.error}</span>}
      {r?.denied && <span className="text-muted-foreground/60"> — denied</span>}
      {tool.error && <span className="text-red-400"> — {tool.error}</span>}
    </div>
  );
}

// ─── Scope sidebar panel ───────────────────────────────────────────────────

function ScopePanel({ settings, resources, onChange, onClose }) {
  const enabled = !!settings.scope_enabled;

  function toggleId(field, id) {
    const cur = settings[field] || [];
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    onChange({ [field]: next });
  }

  function selectAll(field, items) {
    onChange({ [field]: items.map(x => x.id) });
  }
  function clearAll(field) {
    onChange({ [field]: [] });
  }

  const sections = [
    { field: 'allowed_hosting_ids', label: 'Hosting', icon: Globe, items: resources.hosting, accent: 'text-blue-400' },
    { field: 'allowed_db_ids',      label: 'Databases', icon: Database, items: resources.databases, accent: 'text-emerald-400' },
    { field: 'allowed_repo_ids',    label: 'Repositories', icon: GitBranch, items: resources.repos, accent: 'text-violet-400' },
  ];

  return (
    <div className="w-72 border-l border-border bg-muted/10 flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-1.5">
          <FolderTree className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold">Project Scope</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5 border-b border-border">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onChange({ scope_enabled: e.target.checked })}
            className="w-3.5 h-3.5"
          />
          <span className="font-medium">Limit Bot to selected projects</span>
        </label>
        <p className="text-[10px] text-muted-foreground/60 mt-1 leading-snug">
          When on, Bot only sees and can act on the resources you check below — focuses context, reduces noise.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sections.map(sec => {
          const sel = settings[sec.field] || [];
          const Icon = sec.icon;
          return (
            <div key={sec.field} className="px-3 py-2.5 border-b border-border">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className={`w-3 h-3 ${sec.accent}`} />
                  <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground/60">
                    {sec.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground/40">
                    {sel.length}/{sec.items.length}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => selectAll(sec.field, sec.items)}
                    disabled={!enabled || sec.items.length === 0}
                    className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30">
                    all
                  </button>
                  <span className="text-[9px] text-muted-foreground/30">·</span>
                  <button
                    onClick={() => clearAll(sec.field)}
                    disabled={!enabled}
                    className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30">
                    none
                  </button>
                </div>
              </div>
              {sec.items.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/40 italic">None available</p>
              ) : (
                <div className="space-y-0.5">
                  {sec.items.map(item => (
                    <label key={item.id} className={`flex items-center gap-1.5 text-[11px] py-0.5 cursor-pointer ${enabled ? '' : 'opacity-50'}`}>
                      <input
                        type="checkbox"
                        checked={sel.includes(item.id)}
                        onChange={() => toggleId(sec.field, item.id)}
                        disabled={!enabled}
                        className="w-3 h-3"
                      />
                      <span className="truncate flex-1">{item.name}</span>
                      {item.status && item.status !== 'active' && item.status !== 'running' && (
                        <span className="text-[9px] text-muted-foreground/40">{item.status}</span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
