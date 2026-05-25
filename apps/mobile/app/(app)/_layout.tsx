import { Platform } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Spinner, useTheme, YStack } from 'tamagui';
import { useAuthStore } from '../../stores/auth';

/**
 * Authenticated shell — and the app's auth gate.
 *
 *  - While the startup session check runs, render a splash (don't flash the
 *    sign-in screen at a user who turns out to be signed in).
 *  - With no session, redirect to `/sign-in`.
 *  - Otherwise render the four tabs: a bottom tab bar on native, a top nav bar
 *    on web, so every platform exposes the same navigation.
 */
export default function AppLayout() {
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isHydrating) {
    return (
      <YStack flex={1} bg="$background" ai="center" jc="center">
        <Spinner color="$accent" size="large" />
      </YStack>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: isWeb ? 'top' : 'bottom',
        tabBarActiveTintColor: theme.accent?.val,
        tabBarInactiveTintColor: theme.placeholderColor?.val,
        tabBarStyle: {
          backgroundColor: theme.background?.val,
          borderColor: theme.borderColor?.val,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="markets" options={{ title: 'Markets' }} />
      <Tabs.Screen name="analysis" options={{ title: 'Analysis' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      {/* Market detail lives under (app) so it inherits the auth gate, but is
          hidden from the tab bar — it's reached from a card tap. */}
      <Tabs.Screen name="market/[ticker]" options={{ href: null }} />
      {/* Trades list + detail — reached from the dashboard's "View all" link. */}
      <Tabs.Screen name="trades/index" options={{ href: null }} />
      <Tabs.Screen name="trades/[id]" options={{ href: null }} />
    </Tabs>
  );
}
