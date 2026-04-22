import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';

const SHORTCUTS = [
  {
    section: 'Global',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Open Command Palette' },
      { keys: ['Ctrl', 'Space'], label: 'Toggle App Launcher' },
      { keys: ['Ctrl', '`'], label: 'Minimize all windows' },
      { keys: ['Ctrl', ','], label: 'Open Settings' },
      { keys: ['Shift', '?'], label: 'Show keyboard shortcuts' },
    ],
  },
  {
    section: 'Quick Open',
    items: [
      { keys: ['Ctrl', 'T'], label: 'Open Terminal' },
      { keys: ['Ctrl', 'D'], label: 'Open DB' },
      { keys: ['Ctrl', 'G'], label: 'Open Gallery' },
    ],
  },
  {
    section: 'Workspaces',
    items: [
      { keys: ['Ctrl', '1-9'], label: 'Switch to workspace 1–9' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Save current layout' },
    ],
  },
  {
    section: 'Command Palette',
    items: [
      { keys: ['↑', '↓'], label: 'Navigate results' },
      { keys: ['Enter'], label: 'Run selected command' },
      { keys: ['Esc'], label: 'Close palette' },
    ],
  },
];

export default function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable;
      if (e.shiftKey && (e.key === '?' || e.key === '/') && !isTyping) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100001] flex items-center justify-center px-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] rounded-2xl border shadow-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-12 border-b" style={{ borderColor: 'var(--surface-border)' }}>
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 opacity-70" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Keyboard Shortcuts</span>
          </div>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/[0.06]">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 max-h-[60vh] overflow-y-auto">
          {SHORTCUTS.map((sec) => (
            <div key={sec.section}>
              <div className="text-[10px] uppercase tracking-wider opacity-40 font-semibold mb-2">{sec.section}</div>
              <div className="space-y-1.5">
                {sec.items.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="opacity-80" style={{ color: 'var(--text-on-surface)' }}>{s.label}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <kbd
                          key={ki}
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded border"
                          style={{ borderColor: 'var(--surface-border-active)', background: 'var(--surface-overlay)' }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 h-9 border-t flex items-center justify-between text-[10px] opacity-50" style={{ borderColor: 'var(--surface-border)' }}>
          <span>Press <kbd className="px-1 py-0.5 rounded border mx-1" style={{ borderColor: 'var(--surface-border-active)' }}>?</kbd> any time</span>
          <span>VPC OS</span>
        </div>
      </div>
    </div>
  );
}
