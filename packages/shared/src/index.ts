import { z } from 'zod';

/**
 * Contracts shared between the polly API and the polly clients.
 *
 * This package is consumed as raw TypeScript source (no build step): both the
 * Hono backend and the Expo app resolve `@polly/shared` straight to `src/`.
 */

/** Shape of `GET /health` — proves the client/server contract end to end. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  /** ISO-8601 timestamp, e.g. `2026-05-20T18:30:00.000Z`. */
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
