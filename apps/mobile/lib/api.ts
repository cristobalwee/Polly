import { Platform } from 'react-native';
import { authClient } from './auth-client';
import { API_URL } from './config';

/**
 * `fetch` for authenticated polly API calls.
 *
 * Authentication travels differently per platform, so this wrapper hides it:
 *  - **web:** `credentials: 'include'` ships the browser's httpOnly cookie.
 *  - **native:** there is no cookie jar, so we attach the session cookie that
 *    the Better Auth Expo client keeps in SecureStore (`authClient.getCookie()`).
 *
 * It also sets `Content-Type: application/json` whenever a body is present.
 * Auth endpoints themselves go through `authClient`, not this helper.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (Platform.OS !== 'web') {
    const cookie = authClient.getCookie();
    if (cookie) {
      headers.set('Cookie', cookie);
    }
  }
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

/** `apiFetch` + JSON parsing, throwing a useful error on a non-2xx response. */
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}
