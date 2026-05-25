import { serve } from '@hono/node-server';
import { HealthResponseSchema, type HealthResponse } from '@polly/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth';
import { env } from './env';
import { KalshiPublicClient } from './kalshi/public-client';
import { MarketsPoller } from './markets/poller';
import { setTradesPoller } from './portfolio/poller-handle';
import { credentialsRoute } from './routes/credentials';
import { marketsRoute } from './routes/markets';
import { portfolioRoute } from './routes/portfolio';
import { tradesRoute } from './routes/trades';
import { TradesPoller } from './trades/poller';

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

/** Public market data — discover, search, detail (all routes require a session). */
app.route('/markets', marketsRoute);

/** Per-user portfolio (summary, positions, orders). */
app.route('/portfolio', portfolioRoute);

/** Trade history + manual sync trigger. */
app.route('/trades', tradesRoute);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`🟢 polly api listening on http://localhost:${info.port}`);
});

/**
 * Background pollers. Both run in-process as `setInterval` loops — kept
 * separate from the HTTP server so they can later be lifted into their own
 * workers. `MARKETS_POLLER_ENABLED=false` / `TRADES_POLLER_ENABLED=false`
 * disable them (tests, one-off scripts).
 */
if (env.MARKETS_POLLER_ENABLED) {
  const publicClient = new KalshiPublicClient({ environment: env.KALSHI_ENVIRONMENT });
  const marketsPoller = new MarketsPoller({ client: publicClient });
  marketsPoller.start().catch((err) => {
    console.error('✗ markets poller failed to start:', err);
  });

  let tradesPoller: TradesPoller | null = null;
  if (env.TRADES_POLLER_ENABLED) {
    tradesPoller = new TradesPoller({ publicClient });
    setTradesPoller(tradesPoller);
    tradesPoller.start().catch((err) => {
      console.error('✗ trades poller failed to start:', err);
    });
  }

  // Stop the loops cleanly on shutdown so dev restarts don't leak timers.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      marketsPoller.stop();
      tradesPoller?.stop();
      setTradesPoller(null);
      process.exit(0);
    });
  }
}
