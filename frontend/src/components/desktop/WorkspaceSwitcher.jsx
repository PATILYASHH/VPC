import { useState } from 'react';
import { Layers, Plus, X, Save, Edit2, Check } from 'lucide-react';
import useWorkspaceStore from '@/stores/useWorkspaceStore';

export default function WorkspaceSwitcher() {
  const profiles = useWorkspaceStore((s) => s.profiles);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const saveCurrent = useWorkspaceStore((s) => s.saveCurrent);
  const loadProfile = useWorkspaceStore((s) => s.load);
  const overwrite = useWorkspaceStore((s) => s.overwrite);
  const rename = useWorkspaceStore((s) => s.rename);
  const remove = useWorkspaceStore((s) => s.remove);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="hidden lg:flex h-7 px-2 rounded-md items-center gap-1.5 text-[10px] hover:bg-white/[0.05] border opacity-70 hover:opacity-100"
        style={{ borderColor: 'var(--surface-border)' }}
        title="Workspaces"
      >
        <Layers className="w-3 h-3" />
        <span>{profiles.find((p) => p.id === activeId)?.name || 'Workspace'}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
          <div
            className="absolute bottom-9 right-0 w-64 rounded-xl border shadow-2xl overflow-hidden z-[9991] animate-slide-up"
            style={{ background: 'var(--surface-1)', borderColor: 'var(--surface-border-active)' }}
          >
            <div className="px-3 py-2 border-b text-[10px] font-semibold uppercase tracking-wider opacity-50" style={{ borderColor: 'var(--surface-border)' }}>
              Workspaces
            </div>

            <div className="max-h-60 overflow-y-auto">
              {profiles.length === 0 ? (
                <div className="px-4 py-6 text-center text-[11px] opacity-50">
                  No workspaces saved yet
                </div>
              ) : (
                profiles.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-2 px-2 h-9 hover:bg-white/[0.04] ${activeId === p.id ? 'bg-primary/10' : ''}`}
                  >
                    {editingId === p.id ? (
                      <>
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { rename(p.id, editName); setEditingId(null); }
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 bg-transparent border-0 outline-none text-xs"
                          style={{ color: 'var(--text-on-surface)' }}
                        />
                        <button onClick={() => { rename(p.id, editName); setEditingId(null); }} className="p-1 opacity-60 hover:opacity-100">
                          <Check className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { loadProfile(p.id); setOpen(false); }}
                          className="flex-1 flex items-center gap-2 text-left text-xs"
                          style={{ color: 'var(--text-on-surface)' }}
                        >
                          <kbd className="text-[9px] px-1 py-0 rounded bg-white/[0.06]">{idx < 9 ? `⌃${idx + 1}` : ''}</kbd>
                          <span className="truncate">{p.name}</span>
                          <span className="text-[9px] opacity-40">{Object.keys(p.snapshot.windows).length}w</span>
                        </button>
                        <button
                          onClick={() => overwrite(p.id)}
                          className="opacity-0 group-hover:opacity-50 hover:opacity-100 p-1"
                          title="Overwrite with current"
                        >
                          <Save className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                          className="opacity-0 group-hover:opacity-50 hover:opacity-100 p-1"
                          title="Rename"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => remove(p.id)}
                          className="opacity-0 group-hover:opacity-50 hover:opacity-100 hover:text-rose-400 p-1"
                          title="Delete"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="border-t px-2 py-2 flex items-center gap-1" style={{ borderColor: 'var(--surface-border)' }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    saveCurrent(newName.trim());
                    setNewName('');
                  }
                }}
                placeholder="Save current as…"
                className="flex-1 h-7 px-2 rounded text-[11px] bg-white/[0.04] border-0 outline-none placeholder:opacity-40"
                style={{ color: 'var(--text-on-surface)' }}
              />
              <button
                onClick={() => { if (newName.trim()) { saveCurrent(newName.trim()); setNewName(''); } }}
                disabled={!newName.trim()}
                className="h-7 px-2 rounded bg-primary/80 hover:bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed flex items-center"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
