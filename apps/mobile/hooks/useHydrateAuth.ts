import { useEffect } from 'react';
import { authClient } from '../lib/auth-client';
import { useAuthStore } from '../stores/auth';

/**
 * Run the one-time startup session check.
 *
 * On mount this asks Better Auth whether there is a live session — restored
 * from the browser cookie on web, or the SecureStore-backed cookie on native —
 * and seeds the Zustand auth store accordingly. Either way it flips
 * `isHydrating` off so protected routes can stop showing their splash.
 *
 * Mount this exactly once, at the root layout.
 */
export function useHydrateAuth(): void {
  useEffect(() => {
    let cancelled = false;
    const { setUser, clearUser, finishHydrating } = useAuthStore.getState();

    void (async () => {
      try {
        const { data } = await authClient.getSession();
        if (cancelled) return;
        if (data?.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
          });
        } else {
          clearUser();
        }
      } catch {
        if (!cancelled) clearUser();
      } finally {
        if (!cancelled) finishHydrating();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
