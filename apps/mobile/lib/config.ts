import { Platform } from 'react-native';

/**
 * Base URL of the polly API, resolved per platform:
 *  - `EXPO_PUBLIC_API_URL` wins if set (use it for devices / deployed envs).
 *  - Android emulators reach the host machine via 10.0.2.2, not localhost.
 *  - iOS simulator and web share the host's localhost.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001');
