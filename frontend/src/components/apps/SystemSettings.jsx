import { useState } from 'react';
import { Palette, Monitor, Sun, Moon, Sunset, Mountain, Snowflake, Check } from 'lucide-react';
import useDesktopStore from '@/stores/useDesktopStore';

const THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Default dark theme',
    icon: Moon,
    preview: {
      bg: '#0a0e1a',
      surface: '#161b22',
      accent: '#3b82f6',
      text: '#e2e8f0',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light theme',
    icon: Sun,
    preview: {
      bg: '#e8ecf1',
      surface: '#ffffff',
      accent: '#2563eb',
      text: '#1e293b',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue night',
    icon: Snowflake,
    preview: {
      bg: '#0b0f1a',
      surface: '#151a2a',
      accent: '#3b82f6',
      text: '#c8dcff',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm orange tones',
    icon: Sunset,
    preview: {
      bg: '#1a120d',
      surface: '#261b14',
      accent: '#f59e0b',
      text: '#ffe6c8',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic inspired palette',
    icon: Mountain,
    preview: {
      bg: '#2e3440',
      surface: '#3b4252',
      accent: '#88c0d0',
      text: '#d8dee9',
    },
  },
];

export default function SystemSettings() {
  const theme = useDesktopStore((s) => s.theme);
  const setTheme = useDesktopStore((s) => s.setTheme);
  const [activeSection, setActiveSection] = useState('appearance');

  function applyTheme(themeId) {
    setTheme(themeId); // Store handles DOM + style injection
  }

  const sections = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'display', label: 'Display', icon: Monitor },
  ];

  return (
    <div className="h-full flex" style={{ background: 'var(--surface-0)' }}>
      {/* Sidebar */}
      <div className="w-56 border-r flex flex-col py-3 shrink-0" style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border)' }}>
        <div className="px-4 mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-on-surface)' }}>Settings</h2>
        </div>
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2.5 px-4 py-2 text-xs font-medium transition-colors mx-2 rounded-lg ${
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

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeSection === 'appearance' && (
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold mb-1">Appearance</h3>
            <p className="text-sm text-muted-foreground mb-6">Customize how VPC looks on your device.</p>

            {/* Theme Grid */}
            <div className="mb-8">
              <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-4">Theme</h4>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
                      {/* Theme preview */}
                      <div className="aspect-[16/10] relative" style={{ background: t.preview.bg }}>
                        {/* Mini desktop preview */}
                        <div className="absolute inset-2 flex flex-col gap-1.5">
                          {/* Mini window */}
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
                          {/* Mini taskbar */}
                          <div className="h-2.5 rounded-md flex items-center px-1.5 gap-1" style={{ background: t.preview.surface }}>
                            <div className="w-2 h-1 rounded-sm" style={{ background: t.preview.accent }} />
                            <div className="w-3 h-1 rounded-sm" style={{ background: t.preview.text, opacity: 0.15 }} />
                          </div>
                        </div>

                        {/* Selected checkmark */}
                        {isActive && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                        )}
                      </div>

                      {/* Theme name */}
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

            {/* Accent Color Info */}
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
      </div>
    </div>
  );
}
