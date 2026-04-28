// Real PTY-backed shell sessions over WebSocket — gives the in-app
// terminal a true TTY so interactive tools (claude, node, python REPL,
// vim, ssh) work the same as in a real cmd/PowerShell window.

const os = require('os');
const fs = require('fs');
const url = require('url');
const path = require('path');
const { verifyToken } = require('../utils/jwt');
const { buildAugmentedEnv } = require('../utils/shellEnv');

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[pty] node-pty failed to load:', err.message);
}

const sessions = new Map(); // sessionId -> { proc, ws }

function pickShell() {
  if (process.platform === 'win32') {
    // Prefer PowerShell 7 if installed, else Windows PowerShell, else cmd
    const candidates = [
      process.env.ComSpec,
      'pwsh.exe',
      'powershell.exe',
      'cmd.exe',
    ].filter(Boolean);
    for (const c of candidates) {
      if (c.includes('\\') && fs.existsSync(c)) return c;
    }
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function attachPtyWebSocket(httpServer) {
  if (!pty) {
    console.warn('[pty] node-pty not available — interactive terminal disabled');
    return;
  }

  const { WebSocketServer } = require('ws');
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = url.parse(req.url, true);
    if (pathname !== '/api/admin/terminal/ws') return;

    // Auth via JWT in query string (browsers can't set headers on WS)
    const token = query.token;
    if (!token) { socket.destroy(); return; }
    try {
      verifyToken(token);
    } catch {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSession(ws, query);
    });
  });

  console.log('[pty] WebSocket terminal endpoint attached at /api/admin/terminal/ws');
}

function handleSession(ws, query) {
  const sessionId = Math.random().toString(36).slice(2, 10);
  const cols = parseInt(query.cols, 10) || 100;
  const rows = parseInt(query.rows, 10) || 30;
  const cwd = (query.cwd && fs.existsSync(query.cwd)) ? query.cwd : os.homedir();
  const shell = pickShell();

  let proc;
  try {
    proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: buildAugmentedEnv(),
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', text: `Failed to start shell: ${err.message}` }));
    ws.close();
    return;
  }

  sessions.set(sessionId, { proc, ws });
  ws.send(JSON.stringify({ type: 'ready', sessionId, shell, cwd }));

  // PTY output → client
  proc.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  proc.onExit(({ exitCode, signal }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode, signal }));
      ws.close();
    }
    sessions.delete(sessionId);
  });

  // Client → PTY
  ws.on('message', (raw) => {
    const text = raw.toString();
    // Control messages are JSON; raw text is keystrokes
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'resize' && msg.cols && msg.rows) {
          proc.resize(msg.cols, msg.rows);
          return;
        }
        if (msg.type === 'input' && typeof msg.data === 'string') {
          proc.write(msg.data);
          return;
        }
      } catch {
        // Fall through — treat as raw input
      }
    }
    proc.write(text);
  });

  ws.on('close', () => {
    try { proc.kill(); } catch {}
    sessions.delete(sessionId);
  });
}

module.exports = { attachPtyWebSocket };
