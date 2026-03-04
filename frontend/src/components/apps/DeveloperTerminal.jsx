import { useState, useRef, useEffect } from 'react';
import { useApiQuery } from '@/hooks/useApi';
import api from '@/lib/api';

export default function DeveloperTerminal() {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([
    { type: 'system', text: 'VPC Terminal v1.0 - Type "help" for available commands' },
  ]);
  const [executing, setExecuting] = useState(false);
  const outputRef = useRef(null);

  const { data: commandsData } = useApiQuery('terminal-commands', '/admin/terminal/commands');

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;

    setInput('');
    setHistory((h) => [...h, { type: 'input', text: `$ ${cmd}` }]);

    if (cmd === 'help') {
      const commands = commandsData?.commands || [];
      const helpText = commands.length > 0
        ? commands.map((c) => `  ${c.command.padEnd(25)} ${c.description}`).join('\n')
        : '  No commands available';
      setHistory((h) => [...h, { type: 'output', text: `Available commands:\n${helpText}` }]);
      return;
    }

    if (cmd === 'clear') {
      setHistory([{ type: 'system', text: 'Terminal cleared' }]);
      return;
    }

    setExecuting(true);
    try {
      const { data } = await api.post('/admin/terminal/execute', { command: cmd });
      setHistory((h) => [
        ...h,
        {
          type: data.exitCode === 0 ? 'output' : 'error',
          text: data.output,
          duration: data.duration_ms,
        },
      ]);
    } catch (err) {
      setHistory((h) => [
        ...h,
        { type: 'error', text: err.response?.data?.error || err.message },
      ]);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0d1117] text-[#c9d1d9]">
      {/* Output */}
      <div ref={outputRef} className="flex-1 overflow-auto p-3 font-mono text-xs space-y-1">
        {history.map((entry, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap ${
              entry.type === 'input'
                ? 'text-[#58a6ff]'
                : entry.type === 'error'
                  ? 'text-[#f85149]'
                  : entry.type === 'system'
                    ? 'text-[#8b949e]'
                    : 'text-[#c9d1d9]'
            }`}
          >
            {entry.text}
            {entry.duration !== undefined && (
              <span className="text-[#8b949e] ml-2">({entry.duration}ms)</span>
            )}
          </div>
        ))}
        {executing && <div className="text-[#8b949e] animate-pulse">Executing...</div>}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center border-t border-[#30363d] px-3 py-2">
        <span className="text-[#58a6ff] mr-2 font-mono text-xs">$</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command..."
          className="flex-1 bg-transparent text-xs font-mono text-[#c9d1d9] outline-none placeholder-[#484f58]"
          autoFocus
          disabled={executing}
        />
      </form>
    </div>
  );
}
