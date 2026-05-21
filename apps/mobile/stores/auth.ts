import { create } from 'zustand';

/** The current user, as exposed to the UI. */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

type AuthState = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /**
   * True until the initial session check completes on app startup. Protected
   * routes show a splash while this is true rather than flashing the sign-in
   * screen at an already-authenticated user.
   */
  isHydrating: boolean;

  /** Record a signed-in user (after sign-in/up or a successful session check). */
  setUser: (user: AuthUser) => void;
  /** Clear auth state (after sign-out or a failed session check). */
  clearUser: () => void;
  /** Mark the startup session check as finished. */
  finishHydrating: () => void;
};

/**
 * App-wide authentication state.
 *
 * This store is the UI's single read model for "who is signed in". It is
 * hydrated once at startup from Better Auth's session check (see
 * `hooks/useHydrateAuth`) and then kept in sync by the sign-in / sign-up /
 * sign-out flows. Better Auth remains the source of truth on the wire; this is
 * the cached, synchronous view of it.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isHydrating: true,

  setUser: (user) => set({ user, isAuthenticated: true }),
  clearUser: () => set({ user: null, isAuthenticated: false }),
  finishHydrating: () => set({ isHydrating: false }),
}));
