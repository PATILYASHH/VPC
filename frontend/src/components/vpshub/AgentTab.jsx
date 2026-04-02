import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Search, GitPullRequest, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { toast } from 'sonner';

const QUICK_ACTIONS = [
  { label: 'Analyze Repository', icon: Search, action: 'analyze', description: 'Get a full analysis of the codebase' },
  { label: 'Review Open PRs', icon: GitPullRequest, action: 'review_prs', description: 'AI review of open pull requests' },
  { label: 'Resolve PR Conflicts', icon: AlertTriangle, action: 'resolve_conflicts', description: 'Find and resolve merge conflicts' },
  { label: 'Find Issues', icon: Sparkles, action: 'find_issues', description: 'Detect bugs and improvements' },
];

export default function AgentTab({ owner, repo }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text) {
    if (!text.trim()) return;
    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/agent/chat`, {
        message: text,
        history,
      });

      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Failed: ${err.response?.data?.error || err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setMessages(prev => [...prev, { role: 'user', content: 'Analyze this repository' }]);

    try {
      const { data } = await api.post(`/admin/vpshub/repos/${owner}/${repo}/agent/analyze`);
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Analysis failed: ${err.response?.data?.error || err.message}` }]);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleQuickAction(action) {
    if (action === 'analyze') return handleAnalyze();
    if (action === 'review_prs') return sendMessage('Review all open pull requests in this repository. List each PR and provide a summary and any concerns.');
    if (action === 'resolve_conflicts') return sendMessage('Check all open pull requests for merge conflicts. List each PR with conflicts and explain what the conflicts are in simple terms. Suggest how to resolve them.');
    if (action === 'find_issues') return sendMessage('Analyze this codebase and find potential bugs, security issues, and areas for improvement. Be specific about file locations.');
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/15 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold mb-1">VPAI</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              Your AI assistant for code review, conflict resolution, and repository analysis. Ask anything about your code.
            </p>

            {/* Quick actions */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-xl">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.action}
                  onClick={() => handleQuickAction(qa.action)}
                  disabled={loading || analyzing}
                  className="flex flex-col items-start gap-2 p-3 rounded-lg border border-white/[0.06] surface-1 hover:bg-[#1c2129] transition-colors text-left"
                >
                  <qa.icon className="w-4 h-4 text-violet-400" />
                  <div>
                    <div className="text-sm font-medium">{qa.label}</div>
                    <div className="text-xs text-muted-foreground">{qa.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                </div>
              )}
              <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-violet-600/20 text-foreground border border-violet-500/20'
                  : 'surface-1 border border-white/[0.06]'
              }`}>
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              </div>
            </div>
          ))
        )}

        {(loading || analyzing) && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-500/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-violet-400" />
            </div>
            <div className="surface-1 border border-white/[0.06] rounded-lg px-4 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              {analyzing ? 'Analyzing repository...' : 'Thinking...'}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t pt-3">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about the code, request changes, or describe an issue..."
            disabled={loading || analyzing}
            className="flex-1 px-3 py-2 text-sm surface-1 border border-white/[0.06] rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-muted-foreground/50"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || loading || analyzing} className="bg-violet-600 hover:bg-violet-700">
            <Send className="w-4 h-4" />
          </Button>
        </form>
        <div className="flex gap-2 mt-2">
          {messages.length > 0 && QUICK_ACTIONS.map(qa => (
            <button
              key={qa.action}
              onClick={() => handleQuickAction(qa.action)}
              disabled={loading || analyzing}
              className="text-xs px-2.5 py-1 rounded-full border border-white/[0.06] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {qa.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
