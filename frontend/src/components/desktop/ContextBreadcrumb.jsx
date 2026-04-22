import { GitMerge, Database, Layers, Globe, LayoutDashboard, X } from 'lucide-react';
import useContextStore from '@/stores/useContextStore';

const FIELDS = [
  { key: 'repo', icon: GitMerge, color: 'text-violet-400', setter: 'setRepo' },
  { key: 'database', icon: Database, color: 'text-cyan-400', setter: 'setDatabase' },
  { key: 'project', icon: Layers, color: 'text-emerald-400', setter: 'setProject' },
  { key: 'site', icon: Globe, color: 'text-blue-400', setter: 'setSite' },
  { key: 'pipeline', icon: LayoutDashboard, color: 'text-rose-400', setter: 'setPipeline' },
];

export default function ContextBreadcrumb() {
  const ctx = useContextStore();
  const active = FIELDS.filter((f) => ctx[f.key]);
  if (active.length === 0) return null;

  return (
    <div className="hidden md:flex items-center gap-1 px-1.5 h-7 rounded-lg border bg-white/[0.02]" style={{ borderColor: 'var(--surface-border)' }}>
      {active.map((f, i) => {
        const Icon = f.icon;
        const v = ctx[f.key];
        const label = v.name || v.title || v.slug || String(v.id);
        return (
          <div key={f.key} className="flex items-center gap-1">
            {i > 0 && <span className="opacity-30 text-[10px]">/</span>}
            <div className="flex items-center gap-1 px-1.5 h-5 rounded text-[10px]" style={{ color: 'var(--text-on-surface)' }}>
              <Icon className={`w-3 h-3 ${f.color}`} />
              <span className="font-medium max-w-[100px] truncate">{label}</span>
              <button
                onClick={() => ctx[f.setter](null)}
                className="opacity-30 hover:opacity-100 hover:text-rose-400 ml-0.5"
                title="Clear"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
