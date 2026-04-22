import { create } from 'zustand';
import api from '@/lib/api';

const useIntegrationsStore = create((set, get) => ({
  list: [],
  types: {},
  loading: false,
  loaded: false,
  error: null,

  // Reload everything from the server
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [{ data: typesData }, { data: listData }] = await Promise.all([
        get().types && Object.keys(get().types).length ? Promise.resolve({ data: { types: get().types } }) : api.get('/admin/integrations/types'),
        api.get('/admin/integrations'),
      ]);
      set({
        types: typesData.types || {},
        list: listData.integrations || [],
        loading: false,
        loaded: true,
      });
    } catch (err) {
      set({ loading: false, error: err.message });
    }
  },

  // Get all integrations for a single type
  byType: (type) => get().list.filter((i) => i.type === type),

  // Get the default one for a type (server logic also fallback-aware)
  defaultFor: (type) => {
    const list = get().list.filter((i) => i.type === type);
    return list.find((i) => i.is_default)
      || list.find((i) => i.status === 'connected')
      || list[0]
      || null;
  },

  // Promote integration to default
  setDefault: async (id) => {
    await api.post(`/admin/integrations/${id}/default`);
    await get().refresh();
  },

  // Add a new integration
  create: async ({ type, name, config, credentials }) => {
    const { data } = await api.post('/admin/integrations', { type, name, config, credentials });
    await get().refresh();
    return data.integration;
  },

  update: async (id, payload) => {
    const { data } = await api.put(`/admin/integrations/${id}`, payload);
    await get().refresh();
    return data.integration;
  },

  remove: async (id) => {
    await api.delete(`/admin/integrations/${id}`);
    await get().refresh();
  },

  test: async (id) => {
    const { data } = await api.post(`/admin/integrations/${id}/test`);
    await get().refresh();
    return data;
  },
}));

export default useIntegrationsStore;
