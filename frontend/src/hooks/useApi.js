import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export function useApiQuery(key, url, options = {}) {
  return useQuery({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: () => api.get(url).then((r) => r.data),
    ...options,
  });
}

export function useApiMutation(method, url, options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => {
      if (method === 'post') return api.post(url, data).then((r) => r.data);
      if (method === 'put') return api.put(url, data).then((r) => r.data);
      if (method === 'delete') return api.delete(url).then((r) => r.data);
      return api.post(url, data).then((r) => r.data);
    },
    onSuccess: () => {
      if (options.invalidateKeys) {
        options.invalidateKeys.forEach((key) =>
          queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] })
        );
      }
    },
    ...options,
  });
}
