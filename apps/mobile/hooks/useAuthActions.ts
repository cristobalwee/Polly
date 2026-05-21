import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '../lib/auth-client';
import { useAuthStore } from '../stores/auth';

/**
 * Sign-in / sign-up / sign-out, each of which keeps three things in sync:
 * Better Auth (the wire), the Zustand auth store (the UI read model), and
 * navigation. Screens call these instead of touching `authClient` directly.
 */
export function useAuthActions() {
  const router = useRouter();
  const queryClient = useQueryClient();

  /** Pull the live session into the auth store. Returns whether one exists. */
  async function syncSession(): Promise<boolean> {
    const { data } = await authClient.getSession();
    if (data?.user) {
      useAuthStore.getState().setUser({
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
      });
      return true;
    }
    useAuthStore.getState().clearUser();
    return false;
  }

  return {
    /** Email/password sign-in. Throws with a readable message on failure. */
    async signIn(email: string, password: string): Promise<void> {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        throw new Error(error.message ?? 'Could not sign in.');
      }
      await syncSession();
      router.replace('/');
    },

    /** Create an account, then drop straight into the signed-in app. */
    async signUp(name: string, email: string, password: string): Promise<void> {
      const { error } = await authClient.signUp.email({ name, email, password });
      if (error) {
        throw new Error(error.message ?? 'Could not create your account.');
      }
      await syncSession();
      router.replace('/');
    },

    /** Sign out everywhere: server session, auth store, and cached queries. */
    async signOut(): Promise<void> {
      await authClient.signOut();
      useAuthStore.getState().clearUser();
      queryClient.clear();
      router.replace('/sign-in');
    },
  };
}
