// Frontend SSE client. Auto-reconnects with backoff.
// EventSource doesn't support custom headers, so we attach the JWT via query string.

let es = null;
let listeners = new Map(); // channel -> Set<callback>
let backoff = 1000;
let stopped = false;
let openPromise = null;
let resolveOpen;

function connect() {
  if (es) return;
  const token = localStorage.getItem('vpc-token');
  if (!token) return;
  const channels = [...new Set([...listeners.keys()])].join(',') || '*';
  const url = `/api/admin/realtime?channels=${encodeURIComponent(channels)}&_t=${encodeURIComponent(token)}`;
  try {
    es = new EventSource(url);
  } catch {
    return;
  }

  es.onopen = () => {
    backoff = 1000;
    resolveOpen?.();
  };

  es.onmessage = (e) => {
    // Default channel — rare; use named events below
    try {
      const msg = JSON.parse(e.data);
      dispatch(msg.channel, msg.payload);
    } catch {}
  };

  // Generic listener for all custom event types we send
  const wildcards = ['hello', 'metrics', 'jobs', 'notifications', 'logs', 'pr', 'deploy', 'backup'];
  wildcards.forEach((ch) => {
    es.addEventListener(ch, (e) => {
      try {
        const msg = JSON.parse(e.data);
        dispatch(ch, msg.payload);
      } catch {}
    });
  });

  es.onerror = () => {
    if (es) {
      es.close();
      es = null;
    }
    if (stopped) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
}

function dispatch(channel, payload) {
  const set = listeners.get(channel);
  if (set) for (const cb of set) { try { cb(payload); } catch {} }
  const all = listeners.get('*');
  if (all) for (const cb of all) { try { cb({ channel, payload }); } catch {} }
}

export function subscribe(channel, cb) {
  if (!listeners.has(channel)) listeners.set(channel, new Set());
  listeners.get(channel).add(cb);
  if (!es) connect();
  return () => {
    const set = listeners.get(channel);
    if (set) {
      set.delete(cb);
      if (set.size === 0) listeners.delete(channel);
    }
  };
}

export function start() {
  stopped = false;
  if (!openPromise) {
    openPromise = new Promise((r) => { resolveOpen = r; });
  }
  connect();
  return openPromise;
}

export function stop() {
  stopped = true;
  if (es) { es.close(); es = null; }
  listeners.clear();
  openPromise = null;
}
