import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useTheme } from 'tamagui';

/**
 * Authenticated shell. The four destinations render as a bottom tab bar on
 * native and as a top nav bar on web (React Navigation's `tabBarPosition`),
 * so every platform exposes the same navigation.
 */
export default function AppLayout() {
  const theme = useTheme();
  const isWeb = Platform.OS === 'web';

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
    </Tabs>
  );
}
