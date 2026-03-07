import { create } from 'zustand';
import api from '@/lib/api';

const useAuthStore = create((set, get) => ({
  admin: null,
  token: localStorage.getItem('vpc-token'),
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password, totpData) => {
    if (totpData) {
      const { data } = await api.post('/admin/auth/login/totp', {
        tempToken: totpData.tempToken,
        totpCode: totpData.totpCode,
      });
      localStorage.setItem('vpc-token', data.token);
      set({ admin: data.admin, token: data.token, isAuthenticated: true });
      return data.admin;
    }

    const { data } = await api.post('/admin/auth/login', { email, password });

    if (data.requireTotp) {
      return { requireTotp: true, tempToken: data.tempToken };
    }

    localStorage.setItem('vpc-token', data.token);
    set({ admin: data.admin, token: data.token, isAuthenticated: true });
    return data.admin;
  },

  logout: () => {
    localStorage.removeItem('vpc-token');
    set({ admin: null, token: null, isAuthenticated: false });
  },

  // Check if current admin has a specific permission
  hasPermission: (perm) => {
    const admin = get().admin;
    if (!admin?.permissions) return true; // default: allow if no permissions set
    if (admin.permissions.all === true) return true;
    return admin.permissions[perm] === true;
  },

  checkAuth: async () => {
    const token = localStorage.getItem('vpc-token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) {
        throw new Error('Token expired');
      }
      // Fetch full admin info including permissions from server
      try {
        const { data } = await api.get('/admin/me');
        set({
          admin: data.admin,
          token,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        // Fallback to JWT payload if /me fails
        set({
          admin: { id: payload.id, username: payload.username, permissions: { all: true } },
          token,
          isAuthenticated: true,
          isLoading: false,
        });
      }
    } catch {
      localStorage.removeItem('vpc-token');
      set({ admin: null, token: null, isAuthenticated: false, isLoading: false });
    }
  },
}));

export default useAuthStore;
