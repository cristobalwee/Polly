import { QueryClient } from '@tanstack/react-query';
import { apiJson } from './api';

/**
 * The app-wide TanStack Query client.
 *
 * It ships a **default query function**: any query whose first `queryKey`
 * element is an API path string is fetched through `apiJson`, which carries the
 * Better Auth credentials (cookie on web, SecureStore cookie on native). So a
 * query is just:
 *
 *   useQuery({ queryKey: ['/credentials/kalshi'] })
 *
 * with no per-query `queryFn` needed. Mutations still call the API explicitly.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: ({ queryKey }) => apiJson(queryKey[0] as string),
      retry: 1,
      staleTime: 30_000,
    },
  },
});
