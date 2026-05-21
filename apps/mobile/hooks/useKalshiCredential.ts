import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateKalshiCredential, KalshiCredentialResponse } from '@polly/shared';
import { apiFetch, apiJson } from '../lib/api';

/** Query key for the user's Kalshi credential metadata. */
const CREDENTIAL_KEY = ['/credentials/kalshi'] as const;

/**
 * Data layer for the Settings screen's "Connect Kalshi" section.
 *
 * Wraps the four credential endpoints:
 *  - `query` reads the metadata (never the key).
 *  - `connect` stores a credential, then immediately validates it — so the UI
 *    can show a real status straight after connecting.
 *  - `validate` re-runs the Kalshi check on demand.
 *  - `disconnect` deletes the stored credential.
 *
 * Every mutation writes the fresh metadata back into the query cache.
 */
export function useKalshiCredential() {
  const queryClient = useQueryClient();

  const query = useQuery<KalshiCredentialResponse>({ queryKey: CREDENTIAL_KEY });

  const connect = useMutation({
    mutationFn: async (input: CreateKalshiCredential) => {
      await apiJson('/credentials/kalshi', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      // Stored — now run the validation probe and report its result.
      return apiJson<KalshiCredentialResponse>('/credentials/kalshi/validate', {
        method: 'POST',
      });
    },
    onSuccess: (data) => queryClient.setQueryData(CREDENTIAL_KEY, data),
  });

  const validate = useMutation({
    mutationFn: () =>
      apiJson<KalshiCredentialResponse>('/credentials/kalshi/validate', { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(CREDENTIAL_KEY, data),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/credentials/kalshi', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Could not disconnect (HTTP ${res.status})`);
      }
    },
    onSuccess: () =>
      queryClient.setQueryData<KalshiCredentialResponse>(CREDENTIAL_KEY, { credential: null }),
  });

  return { query, connect, validate, disconnect };
}
