import { create } from 'zustand';
import { notify } from './useNotificationStore';

let nextId = 1;

const useJobStore = create((set, get) => ({
  jobs: {},
  panelOpen: false,

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  closePanel: () => set({ panelOpen: false }),

  // Start a new job. type: deploy | backup | terminal | git | ai | upload | task
  startJob: ({ type = 'task', label, app, meta = {}, cancelable = false, onCancel }) => {
    const id = `job-${++nextId}-${Date.now()}`;
    const job = {
      id,
      type,
      label,
      app,
      meta,
      status: 'running', // running | success | error | canceled
      progress: 0,
      logs: [],
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      cancelable,
      onCancel,
    };
    set((s) => ({ jobs: { ...s.jobs, [id]: job } }));
    return id;
  },

  updateJob: (id, patch) => set((s) => {
    const j = s.jobs[id];
    if (!j) return s;
    return { jobs: { ...s.jobs, [id]: { ...j, ...patch } } };
  }),

  appendLog: (id, line) => set((s) => {
    const j = s.jobs[id];
    if (!j) return s;
    const logs = [...j.logs, { ts: Date.now(), text: String(line) }].slice(-200);
    return { jobs: { ...s.jobs, [id]: { ...j, logs } } };
  }),

  finishJob: (id, { status = 'success', error = null, notifyUser = true } = {}) => {
    const j = get().jobs[id];
    if (!j) return;
    set((s) => ({
      jobs: {
        ...s.jobs,
        [id]: { ...j, status, error, finishedAt: Date.now(), progress: status === 'success' ? 100 : j.progress },
      },
    }));
    if (notifyUser) {
      const level = status === 'success' ? 'success' : status === 'error' ? 'error' : 'warning';
      notify({
        title: `${j.label}`,
        message: status === 'success' ? 'Completed' : (error || `Job ${status}`),
        category: j.type === 'deploy' ? 'deploy' : j.type === 'backup' ? 'backup' : 'system',
        level,
      });
    }
  },

  cancelJob: (id) => {
    const j = get().jobs[id];
    if (!j || !j.cancelable) return;
    try { j.onCancel?.(); } catch {}
    get().finishJob(id, { status: 'canceled', notifyUser: true });
  },

  removeJob: (id) => set((s) => {
    const { [id]: _, ...rest } = s.jobs;
    return { jobs: rest };
  }),

  clearFinished: () => set((s) => {
    const jobs = {};
    for (const [id, j] of Object.entries(s.jobs)) {
      if (j.status === 'running') jobs[id] = j;
    }
    return { jobs };
  }),
}));

export default useJobStore;
