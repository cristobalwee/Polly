import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/**
 * Better Auth client — the counterpart to the server `auth` instance.
 *
 * The `expoClient` plugin makes the session portable across all three targets:
 *  - **native (iOS/Android):** the session cookie is persisted in Expo
 *    SecureStore and replayed on every request; `authClient.getCookie()`
 *    exposes it so non-auth API calls can carry it too.
 *  - **web:** the browser stores the httpOnly cookie itself; the plugin is a
 *    no-op there.
 *
 * `baseURL` points at the API root — Better Auth appends its own `/api/auth`.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: 'polly',
      storagePrefix: 'polly',
      storage: SecureStore,
    }),
  ],
});
