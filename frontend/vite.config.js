import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      // Proxy hosted website slugs to the backend in dev mode.
      // Bypasses Vite's own root, internals, and static assets.
      '^/(?!@|src|node_modules|favicon)': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        bypass(req) {
          const url = req.url ?? '/';
          // Let Vite serve the SPA entry point
          if (url === '/' || url === '/index.html') return url;
          // Proxy everything else (slug paths and all their assets) to backend
        },
      },
    },
  },
});
