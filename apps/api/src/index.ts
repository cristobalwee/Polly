import { serve } from '@hono/node-server';
import { HealthResponseSchema, type HealthResponse } from '@polly/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth';
import { env } from './env';
import { credentialsRoute } from './routes/credentials';

const app = new Hono();

/**
 * CORS. The Expo web build is a separate origin, and it must send credentials
 * (the Better Auth session cookie), so the origin is allow-listed explicitly
 * — a wildcard origin is incompatible with `credentials: true`. Native clients
 * are not subject to CORS.
 */
app.use(
  '*',
  cors({
    origin: [env.WEB_ORIGIN],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

/**
 * Health endpoint. Building the response through the shared Zod schema
 * guarantees the API can only ship a payload the clients can parse.
 */
app.get('/health', (c) => {
  const body: HealthResponse = HealthResponseSchema.parse({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
  return c.json(body);
});

/**
 * Better Auth owns everything under `/api/auth/*` — sign-up, sign-in, sign-out,
 * session lookup. We hand it the raw Web `Request` and return its `Response`.
 */
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

/** Kalshi credential management (all routes require a session). */
app.route('/credentials', credentialsRoute);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`🟢 polly api listening on http://localhost:${info.port}`);
});
