import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../stores/auth';

/**
 * Public auth screens (`/sign-in`, `/sign-up`).
 *
 * Mirror of the `(app)` gate: an already-signed-in user who lands here is sent
 * straight to the dashboard. The hydration check is awaited so we don't bounce
 * a user out of sign-in before the session check has even finished.
 */
export default function AuthLayout() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isHydrating && isAuthenticated) {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
