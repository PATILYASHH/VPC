import { useState, useEffect, useRef } from 'react';
import { Palette, Monitor, Sun, Moon, Sunset, Mountain, Snowflake, Check, Power, RefreshCw, Loader2, Server, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import useDesktopStore from '@/stores/useDesktopStore';
import api from '@/lib/api';

const THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Default dark theme',
    icon: Moon,
    preview: { bg: '#0a0e1a', surface: '#161b22', accent: '#3b82f6', text: '#e2e8f0' },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light theme',
    icon: Sun,
    preview: { bg: '#e8ecf1', surface: '#ffffff', accent: '#2563eb', text: '#1e293b' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue night',
    icon: Snowflake,
    preview: { bg: '#0b0f1a', surface: '#151a2a', accent: '#3b82f6', text: '#c8dcff' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm orange tones',
    icon: Sunset,
    preview: { bg: '#1a120d', surface: '#261b14', accent: '#f59e0b', text: '#ffe6c8' },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic inspired palette',
    icon: Mountain,
    preview: { bg: '#2e3440', surface: '#3b4252', accent: '#88c0d0', text: '#d8dee9' },
  },
];

export default function SystemSettings() {
  const theme = useDesktopStore((s) => s.theme);
  const setTheme = useDesktopStore((s) => s.setTheme);
  const clockFormat = useDesktopStore((s) => s.clockFormat);
  const setClockFormat = useDesktopStore((s) => s.setClockFormat);
  const [activeSection, setActiveSection] = useState('appearance');
  const [restarting, setRestarting] = useState(false);
  const pollRef = useRef(null);
  const timeoutRef = useRef(null);
  const delayRef = useRef(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (delayRef.current) clearTimeout(delayRef.current);
    };
  }, []);

  function applyTheme(themeId) {
    setTheme(themeId);
  }

  async function restartServer() {
    if (!window.confirm('Restart the VPC server?\n\nAll active connections will be dropped.\nThe page will reload when the server is back.')) return;
    setRestarting(true);
    try {
      await api.post('/admin/vpshub/system/restart');
    } catch { /* server already restarting */ }
    toast.success('Restarting VPC server...');
    delayRef.current = setTimeout(() => {
      pollRef.current = setInterval(async () => {
        try {
          await fetch('/health');
          clearInterval(pollRef.current);
          window.location.reload();
        } catch {}
      }, 2000);
      timeoutRef.current = setTimeout(() => { clearInterval(pollRef.current); setRestarting(false); }, 120000);
    }, 3000);
  }

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'display', label: 'Display', icon: Monitor },
    { id: 'server', label: 'Server', icon: Server },
  ];

  return (
    <div className="h-full flex flex-col sm:flex-row" style={{ background: 'var(--surface-0)' }}>
      {/* Sidebar - horizontal tabs on mobile, vertical sidebar on desktop */}
      <div className="sm:w-56 border-b sm:border-b-0 sm:border-r flex sm:flex-col py-2 sm:py-3 shrink-0 overflow-x-auto sm:overflow-x-visible" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
        <div className="px-4 mb-2 sm:mb-4 hidden sm:block">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Settings</h2>
        </div>
        <div className="flex sm:flex-col gap-0.5 px-2 sm:px-0">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2 text-xs font-medium transition-colors sm:mx-2 rounded-lg whitespace-nowrap ${
                activeSection === s.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-[var(--surface-hover)]'
              }`}
            >
              <s.icon className="w-4 h-4" />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {activeSection === 'appearance' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold mb-1">Appearance</h3>
            <p className="text-sm text-muted-foreground mb-6">Customize how VPC looks on your device.</p>

            <div className="mb-8">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">Theme</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {THEMES.map(t => {
                  const isActive = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => applyTheme(t.id)}
                      className={`group relative rounded-xl border-2 overflow-hidden transition-all ${
                        isActive ? 'border-primary shadow-lg shadow-primary/10' : 'border-transparent hover:border-[var(--surface-border-active)]'
                      }`}
                    >
                      <div className="aspect-[16/10] relative" style={{ background: t.preview.bg }}>
                        <div className="absolute inset-2 flex flex-col gap-1.5">
                          <div className="flex-1 rounded-md overflow-hidden" style={{ background: t.preview.surface }}>
                            <div className="h-3 flex items-center px-1.5 gap-0.5" style={{ background: t.preview.surface, borderBottom: `1px solid ${t.preview.bg}` }}>
                              <div className="w-1 h-1 rounded-full bg-red-400/60" />
                              <div className="w-1 h-1 rounded-full bg-yellow-400/60" />
                              <div className="w-1 h-1 rounded-full bg-green-400/60" />
                            </div>
                            <div className="p-1.5 space-y-1">
                              <div className="h-1 rounded-full w-3/4" style={{ background: t.preview.text, opacity: 0.15 }} />
                              <div className="h-1 rounded-full w-1/2" style={{ background: t.preview.text, opacity: 0.1 }} />
                              <div className="h-1 rounded-full w-2/3" style={{ background: t.preview.accent, opacity: 0.3 }} />
                            </div>
                          </div>
                          <div className="h-2.5 rounded-md flex items-center px-1.5 gap-1" style={{ background: t.preview.surface }}>
                            <div className="w-2 h-1 rounded-sm" style={{ background: t.preview.accent }} />
                            <div className="w-3 h-1 rounded-sm" style={{ background: t.preview.text, opacity: 0.15 }} />
                          </div>
                        </div>
                        {isActive && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2.5" style={{ background: 'var(--surface-1)' }}>
                        <div className="flex items-center gap-2">
                          <t.icon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">{t.name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5 ml-5.5">{t.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
              <div className="flex items-center gap-3">
                <Palette className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-xs font-medium">Active Theme: {THEMES.find(t => t.id === theme)?.name || 'Dark'}</p>
                  <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                    Theme changes are saved automatically and persist across sessions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'display' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold mb-1">Display</h3>
            <p className="text-sm text-muted-foreground mb-6">Display and window settings.</p>
            <div className="space-y-4">
              <div className="p-4 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-medium">Clock Format</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                      Used by the taskbar clock and other time displays in the desktop.
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {clockFormat === '12h'
                      ? new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                      : new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setClockFormat('24h')}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      clockFormat === '24h'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-[var(--surface-border)] text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    <div className="font-semibold">24-hour</div>
                    <div className="text-[10px] opacity-70 font-mono mt-0.5">e.g. 14:30</div>
                  </button>
                  <button
                    onClick={() => setClockFormat('12h')}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      clockFormat === '12h'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-[var(--surface-border)] text-muted-foreground hover:bg-muted/30'
                    }`}
                  >
                    <div className="font-semibold">12-hour</div>
                    <div className="text-[10px] opacity-70 font-mono mt-0.5">e.g. 2:30 PM</div>
                  </button>
                </div>
              </div>
              <div className="p-4 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Window Persistence</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5">Open windows are saved and restored on page reload.</p>
                  </div>
                  <div className="w-9 h-5 rounded-full bg-primary relative">
                    <span className="absolute top-0.5 left-[18px] w-4 h-4 rounded-full bg-white shadow" />
                  </div>
                </div>
              </div>
              <div className="p-4 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Window Animations</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-0.5">Smooth minimize and restore transitions.</p>
                  </div>
                  <div className="w-9 h-5 rounded-full bg-primary relative">
                    <span className="absolute top-0.5 left-[18px] w-4 h-4 rounded-full bg-white shadow" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'server' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold mb-1">Server Control</h3>
            <p className="text-sm text-muted-foreground mb-6">Manage the VPC server directly from here. No SSH needed.</p>

            <div className="space-y-4">
              {/* Restart Server */}
              <div className="p-5 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                    <RefreshCw className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Restart Server</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
                      Restart the VPC backend server. Use this after installing upgrades or changing configuration.
                      All active connections will be temporarily dropped. The page will automatically reload when the server is back online.
                    </p>
                    <Button
                      onClick={restartServer}
                      disabled={restarting}
                      className="mt-3 bg-amber-600 hover:bg-amber-500 text-white"
                    >
                      {restarting ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Restarting...</>
                      ) : (
                        <><RefreshCw className="w-4 h-4 mr-2" /> Restart Server</>
                      )}
                    </Button>
                    {restarting && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                          <div className="h-full bg-amber-500/50 rounded-full animate-pulse" style={{ width: '70%' }} />
                        </div>
                        <p className="text-[10px] text-amber-400/70 mt-1.5">Waiting for server to come back online...</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Shutdown Server */}
              <div className="p-5 rounded-xl border border-red-500/20" style={{ background: 'var(--surface-1)' }}>
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                    <Power className="w-5 h-5 text-red-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-400">Shutdown Server</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">
                      Stop the VPC server completely. You will need SSH access to start it again.
                      Only use this if you know what you're doing.
                    </p>
                    <Button
                      onClick={async () => {
                        if (!window.confirm('SHUTDOWN the VPC server?\n\nYou will need SSH access to start it again.\nThis will disconnect you immediately.')) return;
                        if (!window.confirm('Are you absolutely sure? The server will STOP and you cannot restart it from here.')) return;
                        try {
                          await api.post('/admin/vpshub/system/restart');
                          toast.success('Server shutting down...');
                        } catch {}
                      }}
                      variant="destructive"
                      className="mt-3"
                    >
                      <Power className="w-4 h-4 mr-2" /> Shutdown Server
                    </Button>
                  </div>
                </div>
              </div>

              {/* Server Info */}
              <div className="p-4 rounded-xl border" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Server className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold">Server Info</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VPC OS Version</span>
                    <span className="font-mono font-medium">v3.0.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">VPC Sync Extension</span>
                    <span className="font-mono font-medium">v9.0.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Node.js</span>
                    <span className="font-mono font-medium">{typeof process !== 'undefined' ? process.version : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Platform</span>
                    <span className="font-mono font-medium">{navigator.platform}</span>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                  Server restart typically takes 3-10 seconds. If the server doesn't come back within 2 minutes, you may need to check it via SSH.
                  The restart uses PM2 if available, otherwise the process exits and your process manager should restart it.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
