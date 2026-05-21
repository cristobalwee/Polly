import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { TamaguiProvider, Theme } from 'tamagui';
import { config } from '../tamagui.config';
import { useHydrateAuth } from '../hooks/useHydrateAuth';
import { queryClient } from '../lib/query-client';

/**
 * Root layout. Wraps every route in:
 *  - `QueryClientProvider` — TanStack Query, configured in `lib/query-client`.
 *  - `TamaguiProvider` — the app theme.
 *
 * It also kicks off the one-time auth hydration so the rest of the tree can
 * trust the Zustand auth store. The `(app)` and `(auth)` route groups live one
 * level down; `(app)` is gated, `(auth)` is public.
 */
export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  useHydrateAuth();

  return (
    <QueryClientProvider client={queryClient}>
      <TamaguiProvider config={config} defaultTheme={scheme}>
        <Theme name={scheme}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false }} />
        </Theme>
      </TamaguiProvider>
    </QueryClientProvider>
  );
}
