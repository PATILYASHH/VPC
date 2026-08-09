import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import useAuthStore from '@/stores/useAuthStore';

// Real PTY-backed terminal. Streams keystrokes to the backend over a WebSocket
// and renders the live shell output via xterm.js. Interactive tools (claude,
// node REPL, python REPL, vim, ssh) work the same as in a native terminal.
export default function DeveloperTerminal() {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting | connected | disconnected | error
  const [shellName, setShellName] = useState('shell');
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      theme: {
        background: '#0c0c0c',
        foreground: '#e0e0e0',
        cursor: '#27c93f',
        cursorAccent: '#0c0c0c',
        selectionBackground: '#264f78',
        black: '#0c0c0c',
        red: '#f85149',
        green: '#27c93f',
        yellow: '#ffbd2e',
        blue: '#58a6ff',
        magenta: '#bf91f3',
        cyan: '#56d4dd',
        white: '#e0e0e0',
        brightBlack: '#6e7681',
        brightRed: '#ff7b72',
        brightGreen: '#7ee787',
        brightYellow: '#f2cc60',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#a5e3e8',
        brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Welcome banner before WS connects
    term.writeln('\x1b[32m  __     ______   ____\x1b[0m');
    term.writeln('\x1b[32m  \\ \\   / /  _ \\ / ___|   Virtual Private Computer\x1b[0m');
    term.writeln('\x1b[32m   \\ \\ / /| |_) | |       Terminal v3.0  (real PTY)\x1b[0m');
    term.writeln('\x1b[32m    \\ V / |  __/| |___\x1b[0m');
    term.writeln('\x1b[32m     \\_/  |_|    \\____|\x1b[0m');
    term.writeln('');
    term.writeln('\x1b[90mConnecting to shell…\x1b[0m');

    // Connect WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const cols = term.cols, rows = term.rows;
    const wsUrl = `${proto}//${window.location.host}/api/admin/terminal/ws?token=${encodeURIComponent(token || '')}&cols=${cols}&rows=${rows}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');

    ws.onmessage = (event) => {
      let data = event.data;

      // Control messages are sent as JSON strings; raw bytes are PTY output
      if (typeof data === 'string' && data.startsWith('{') && data.endsWith('}')) {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'ready') {
            setShellName((msg.shell || 'shell').split(/[\\/]/).pop().replace(/\.exe$/i, ''));
            term.writeln(`\x1b[90m✓ Connected to ${msg.shell || 'shell'}  (cwd: ${msg.cwd})\x1b[0m`);
            term.writeln('');
            return;
          }
          if (msg.type === 'exit') {
            term.writeln(`\r\n\x1b[33m[shell exited code=${msg.exitCode}]\x1b[0m`);
            return;
          }
          if (msg.type === 'error') {
            term.writeln(`\r\n\x1b[31m${msg.text}\x1b[0m`);
            return;
          }
        } catch { /* fall through — treat as raw output */ }
      }

      // Raw PTY output
      if (typeof data === 'string') term.write(data);
      else term.write(new Uint8Array(data));
    };

    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('error');

    // Forward keystrokes to PTY
    const dataDisposer = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Resize PTY when terminal size changes
    const resizeObserver = new ResizeObserver(() => {
      try { fit.fit(); } catch {}
    });
    resizeObserver.observe(containerRef.current);

    const sizeDisposer = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Auto-fit on window resize
    const onWinResize = () => { try { fit.fit(); } catch {} };
    window.addEventListener('resize', onWinResize);

    return () => {
      window.removeEventListener('resize', onWinResize);
      resizeObserver.disconnect();
      dataDisposer.dispose();
      sizeDisposer.dispose();
      try { ws.close(); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
    };
  }, [token]);

  const statusColor = {
    connecting: 'text-amber-400',
    connected: 'text-emerald-400',
    disconnected: 'text-red-400',
    error: 'text-red-400',
  }[status];

  return (
    <div className="h-full flex flex-col bg-[#0c0c0c]">
      {/* macOS-style title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a1a] border-b border-[#2a2a2a] select-none shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
        </div>
        <div className="text-[11px] text-[#8b949e] font-mono flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${
            status === 'connected' ? 'bg-emerald-500' :
            status === 'connecting' ? 'bg-amber-500 animate-pulse' :
            'bg-red-500'
          }`} />
          {shellName} <span className={statusColor}>·</span> <span className={statusColor}>{status}</span>
        </div>
        <div className="text-[10px] text-[#6e7681]">vpc-pty</div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-2 py-1"
        style={{ background: '#0c0c0c' }}
        onContextMenu={(e) => {
          // Right-click to paste
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(text);
          }).catch(() => {});
        }}
      />
    </div>
  );
}
