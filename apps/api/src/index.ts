import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HealthResponseSchema, type HealthResponse } from '@polly/shared';

const app = new Hono();

// Allow the Expo web build (and any local client) to call the API directly.
app.use('*', cors());

/**
 * Placeholder health endpoint. Building the response through the shared Zod
 * schema guarantees the API can only ship a payload the clients can parse.
 */
app.get('/health', (c) => {
  const body: HealthResponse = HealthResponseSchema.parse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
  return c.json(body);
});

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🟢 polly api listening on http://localhost:${info.port}`);
});
