import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Button, Spinner, Text, YStack } from 'tamagui';
import { HealthResponseSchema, type HealthResponse } from '@polly/shared';

/**
 * Resolve the API base URL per platform:
 *  - `EXPO_PUBLIC_API_URL` wins if set (use it for devices / deployed envs).
 *  - Android emulators reach the host machine via 10.0.2.2, not localhost.
 *  - iOS simulator and web share the host's localhost.
 */
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android'
    ? 'http://10.0.2.2:3001'
    : 'http://localhost:3001');

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; data: HealthResponse }
  | { status: 'error'; message: string };

/**
 * Dashboard placeholder. Its real job today: fetch the backend health
 * endpoint and render the timestamp — proof that the cross-platform client
 * reaches the Hono API and parses its response through the shared schema.
 */
export default function Dashboard() {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  const loadHealth = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const res = await fetch(`${API_URL}/health`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = HealthResponseSchema.parse(await res.json());
      setState({ status: 'ok', data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <YStack flex={1} bg="$background" ai="center" jc="center" gap="$3" p="$4">
      <Text fontSize="$10" fontWeight="800" color="$accent">
        polly
      </Text>
      <Text fontSize="$5" fontWeight="600" color="$color">
        Dashboard
      </Text>

      {state.status === 'loading' && <Spinner color="$accent" size="large" />}

      {state.status === 'ok' && (
        <YStack ai="center" gap="$1">
          <Text fontSize="$3" color="$placeholderColor">
            backend status: {state.data.status}
          </Text>
          <Text fontSize="$3" color="$placeholderColor">
            health timestamp
          </Text>
          <Text fontSize="$4" fontWeight="600" color="$color">
            {state.data.timestamp}
          </Text>
        </YStack>
      )}

      {state.status === 'error' && (
        <YStack ai="center" gap="$2">
          <Text fontSize="$3" color="$placeholderColor" textAlign="center">
            Could not reach the API at {API_URL}
          </Text>
          <Text fontSize="$2" color="$placeholderColor">
            {state.message}
          </Text>
          <Button size="$3" onPress={() => void loadHealth()}>
            Retry
          </Button>
        </YStack>
      )}
    </YStack>
  );
}
