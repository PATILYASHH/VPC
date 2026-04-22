import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import useAuthStore from '@/stores/useAuthStore';
import LoginPage from '@/pages/LoginPage';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import Desktop from '@/components/desktop/Desktop';
import { Toaster } from 'sonner';
import { start as startRealtime, stop as stopRealtime } from '@/lib/realtime';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (isAuthenticated) {
      startRealtime();
      return () => stopRealtime();
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Desktop />
      <Toaster position="bottom-right" theme="dark" richColors />
    </QueryClientProvider>
  );
}
