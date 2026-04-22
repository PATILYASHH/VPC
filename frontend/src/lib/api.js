import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vpc-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses globally + INTEGRATION_MISSING (412) — open Connections app
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('vpc-token');
      window.location.reload();
    }
    if (error.response?.status === 412 && error.response?.data?.code === 'INTEGRATION_MISSING') {
      // Lazy-import to avoid circular deps
      import('@/stores/useWindowStore').then(({ default: useWindowStore }) => {
        useWindowStore.getState().openWindow('connections');
      });
      import('@/stores/useNotificationStore').then(({ notify }) => {
        notify({
          title: `${error.response.data.integrationType} not connected`,
          message: error.response.data.error,
          category: 'system',
          level: 'warning',
          actions: [],
        });
      });
    }
    return Promise.reject(error);
  }
);

export default api;
