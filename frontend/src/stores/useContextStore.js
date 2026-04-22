import { create } from 'zustand';

const STORAGE_KEY = 'vpc-context';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      repo: state.repo,
      database: state.database,
      project: state.project,
      site: state.site,
      pipeline: state.pipeline,
      recent: state.recent.slice(0, 10),
    }));
  } catch {}
}

const initial = load() || {};

const useContextStore = create((set, get) => ({
  // Active entities — apps subscribe to these and react
  repo: initial.repo || null,           // { id, name, slug }
  database: initial.database || null,   // { id, name, project_id }
  project: initial.project || null,     // { id, name, slug }
  site: initial.site || null,           // { id, name, slug }
  pipeline: initial.pipeline || null,   // { id, name }
  recent: initial.recent || [],         // [{ kind, id, label, ts }]

  setRepo: (repo) => { set({ repo }); persist(get()); get()._pushRecent('repo', repo); },
  setDatabase: (database) => { set({ database }); persist(get()); get()._pushRecent('database', database); },
  setProject: (project) => { set({ project }); persist(get()); get()._pushRecent('project', project); },
  setSite: (site) => { set({ site }); persist(get()); get()._pushRecent('site', site); },
  setPipeline: (pipeline) => { set({ pipeline }); persist(get()); get()._pushRecent('pipeline', pipeline); },

  clearAll: () => { set({ repo: null, database: null, project: null, site: null, pipeline: null }); persist(get()); },

  _pushRecent: (kind, entity) => {
    if (!entity) return;
    set((s) => {
      const label = entity.name || entity.title || entity.slug || String(entity.id);
      const item = { kind, id: entity.id, label, ts: Date.now() };
      const recent = [item, ...s.recent.filter((r) => !(r.kind === kind && r.id === entity.id))].slice(0, 10);
      return { recent };
    });
    persist(get());
  },
}));

export default useContextStore;
