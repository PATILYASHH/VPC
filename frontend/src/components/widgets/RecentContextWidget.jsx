import { Clock, GitMerge, Database, Layers, Globe, LayoutDashboard } from 'lucide-react';
import useContextStore from '@/stores/useContextStore';
import WidgetShell from './WidgetShell';

const ICONS = {
  repo: { icon: GitMerge, color: 'text-violet-400' },
  database: { icon: Database, color: 'text-cyan-400' },
  project: { icon: Layers, color: 'text-emerald-400' },
  site: { icon: Globe, color: 'text-blue-400' },
  pipeline: { icon: LayoutDashboard, color: 'text-rose-400' },
};

export default function RecentContextWidget({ onRemove }) {
  const recent = useContextStore((s) => s.recent);
  const setRepo = useContextStore((s) => s.setRepo);
  const setDb = useContextStore((s) => s.setDatabase);
  const setProject = useContextStore((s) => s.setProject);
  const setSite = useContextStore((s) => s.setSite);
  const setPipeline = useContextStore((s) => s.setPipeline);

  const setters = { repo: setRepo, database: setDb, project: setProject, site: setSite, pipeline: setPipeline };

  return (
    <WidgetShell title="Recent" icon={Clock} onRemove={onRemove}>
      {recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full opacity-40 gap-1.5">
          <Clock className="w-5 h-5" />
          <span className="text-[10px]">No history</span>
        </div>
      ) : (
        <div>
          {recent.map((r) => {
            const meta = ICONS[r.kind] || { icon: Clock, color: 'opacity-60' };
            const Icon = meta.icon;
            return (
              <button
                key={`${r.kind}-${r.id}-${r.ts}`}
                onClick={() => setters[r.kind]?.({ id: r.id, name: r.label })}
                className="w-full flex items-center gap-2 px-3 h-8 hover:bg-white/[0.04] text-left"
              >
                <Icon className={`w-3 h-3 ${meta.color}`} />
                <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-on-surface)' }}>{r.label}</span>
                <span className="text-[9px] opacity-30 capitalize">{r.kind}</span>
              </button>
            );
          })}
        </div>
      )}
    </WidgetShell>
  );
}
