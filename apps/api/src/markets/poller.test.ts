import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema';
import { markets, marketCategoriesMapping, marketPriceHistory } from '../db/schema';
import { KalshiPublicClient } from '../kalshi/public-client';
import type { KalshiMarket } from '../kalshi/schemas';
import { MarketsPoller, type PollerLogger } from './poller';

/**
 * Integration tests for the markets poller.
 *
 * The poller is the place where Kalshi, the categoriser and Postgres come
 * together, so the tests run against a real `polly_test` database (the dev
 * `polly_dev` is left alone). A test-only client overrides `fetch` so no
 * outbound HTTP fires; each `it` truncates the markets tables, exercises one
 * cadence of the poller, and asserts on the database.
 *
 * What we pin down here:
 *  - active markets are upserted with normalised status, cents prices and
 *    notional volumes,
 *  - a 429 burst is followed by a successful retry (backoff is honoured),
 *  - a malformed market is logged and skipped rather than crashing the run,
 *  - two concurrent active polls leave the table consistent (idempotency).
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const db = drizzle(pool, { schema });

beforeAll(() => {
  // Confirm we're pointed at the dedicated test database before any test wipes
  // tables — refuse to clobber dev / prod by accident.
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('test')) {
    throw new Error(
      `Refusing to run poller tests: DATABASE_URL is "${url}". Point it at polly_test.`,
    );
  }
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // FK from market_price_history → markets is ON DELETE CASCADE, so deleting
  // the parents clears history too. Leave the category mapping in place; the
  // poller is supposed to seed it lazily, which is what the first test checks.
  await db.delete(marketPriceHistory);
  await db.delete(markets);
  await db.delete(marketCategoriesMapping);
});

/* ------------------------- Test fixtures + helpers ------------------------ */

/** Fake `fetch` that serves a queue of canned responses in order. */
function fetchQueue(responses: Response[]): typeof fetch {
  const queue = [...responses];
  return (async () => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    return next;
  }) as unknown as typeof fetch;
}

/** Build a JSON `Response`. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A logger that records calls so tests can assert on warnings/errors. */
function recordingLogger(): PollerLogger & { calls: { level: string; msg: string }[] } {
  const calls: { level: string; msg: string }[] = [];
  return {
    calls,
    info: (msg) => calls.push({ level: 'info', msg }),
    warn: (msg) => calls.push({ level: 'warn', msg }),
    error: (msg) => calls.push({ level: 'error', msg }),
  };
}

/** Minimal but realistic Kalshi market payload. */
function market(overrides: Partial<KalshiMarket> = {}): KalshiMarket {
  return {
    ticker: `TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    event_ticker: 'EV-1',
    title: 'Will it rain tomorrow?',
    status: 'active',
    yes_bid_dollars: '0.45',
    yes_ask_dollars: '0.50',
    no_bid_dollars: '0.50',
    no_ask_dollars: '0.55',
    volume_24h_fp: '100.00',
    volume_fp: '500.00',
    ...overrides,
  } as KalshiMarket;
}

/** Build a poller pointed at the test DB with a queued `fetch`. */
function makePoller(responses: Response[], logger = recordingLogger()) {
  const client = new KalshiPublicClient({
    fetchImpl: fetchQueue(responses),
    sleep: async () => undefined,
    rateLimit: { capacity: 100, refillPerSec: 100 },
    backoff: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1 },
  });
  return { poller: new MarketsPoller({ client, database: db, logger }), logger };
}

/* ------------------------------- Test cases ------------------------------- */

describe('MarketsPoller.pollActiveMarkets', () => {
  it('upserts active markets with normalised prices and volumes', async () => {
    const responses = [
      // events page (categories) — single event, then end.
      json({ events: [{ event_ticker: 'EV-1', category: 'Climate and Weather' }], cursor: null }),
      // markets page — one market, then end.
      json({ markets: [market({ ticker: 'WX-1' })], cursor: null }),
    ];
    const { poller } = makePoller(responses);

    await poller.pollActiveMarkets();

    const rows = await db.select().from(markets);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.ticker).toBe('WX-1');
    expect(row.status).toBe('active');
    // 0.45 → 45¢, 0.50 → 50¢.
    expect(row.yesBid).toBe(45);
    expect(row.yesAsk).toBe(50);
    // Notional volume = contracts × mid (45+50)/2 = ~47¢ → 100 × 47 = 4700.
    expect(row.volume24hCents).toBeGreaterThan(0);
    // Category seeded + applied: 'Climate and Weather' → 'Weather'.
    expect(row.category).toBe('Weather');
  });

  it('logs and skips a malformed market without aborting the batch', async () => {
    // The client validates the array shape; a ticker-less market in the
    // payload would fail Zod parse. To exercise the poller's per-row guard,
    // we instead inject one market whose title is missing — Zod accepts that
    // (it has a default in our schema) but the row transform would still…
    // actually `title` is required. Use a market that parses fine through
    // Zod but breaks `toMarketRow` — e.g. status=`open` is fine. We force the
    // break by overriding `ticker` to an empty string, which Zod's `z.string()`
    // accepts but our row transform rejects.
    const responses = [
      json({ events: [], cursor: null }),
      json({
        markets: [
          market({ ticker: '', title: 'busted' }),
          market({ ticker: 'GOOD-1' }),
        ],
        cursor: null,
      }),
    ];
    const { poller, logger } = makePoller(responses);

    // The poller must not throw — that is the resilience the spec asks for.
    await expect(poller.pollActiveMarkets()).resolves.toBeUndefined();

    const rows = await db.select().from(markets);
    expect(rows.map((r) => r.ticker)).toEqual(['GOOD-1']);

    // At least one warn line names the skipped market.
    expect(logger.calls.some((c) => c.level === 'warn' && c.msg.includes('skipped'))).toBe(true);
  });

  it('retries through a 429 burst (rate-limit backoff)', async () => {
    const responses = [
      json({ events: [], cursor: null }),
      json({ error: 'slow down' }, 429),
      json({ error: 'slow down' }, 429),
      json({ markets: [market({ ticker: 'RL-1' })], cursor: null }),
    ];
    const { poller } = makePoller(responses);

    await poller.pollActiveMarkets();

    const rows = await db.select().from(markets);
    expect(rows.map((r) => r.ticker)).toEqual(['RL-1']);
  });

  it('two concurrent polls leave the table consistent and un-duplicated', async () => {
    // Each poll is given its own response queue so neither steps on the other.
    const queueA = [
      json({ events: [{ event_ticker: 'EV-1', category: 'Politics' }], cursor: null }),
      json({ markets: [market({ ticker: 'C-1', title: 'A' })], cursor: null }),
    ];
    const queueB = [
      json({ events: [{ event_ticker: 'EV-1', category: 'Politics' }], cursor: null }),
      json({ markets: [market({ ticker: 'C-1', title: 'B' })], cursor: null }),
    ];
    const { poller: pollerA } = makePoller(queueA);
    const { poller: pollerB } = makePoller(queueB);

    await Promise.all([pollerA.pollActiveMarkets(), pollerB.pollActiveMarkets()]);

    const rows = await db.select().from(markets);
    // The ticker is the primary key, so no matter the interleaving the table
    // has exactly one row for it.
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('C-1');
    // The title is whichever poller wrote last — either is acceptable, what
    // matters is the row is intact and parseable.
    expect(['A', 'B']).toContain(rows[0].title);
  });
});

describe('MarketsPoller.pollCandlesticks', () => {
  it('is a clean no-op when no markets are engaged', async () => {
    const { poller, logger } = makePoller([]);
    await poller.pollCandlesticks();
    expect(logger.calls.some((c) => c.msg === 'candlesticks poll ok')).toBe(true);
  });
});
