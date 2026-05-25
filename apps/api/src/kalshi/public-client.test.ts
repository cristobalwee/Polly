import { describe, expect, it, vi } from 'vitest';
import { KalshiApiError, KalshiPublicClient } from './public-client';

/**
 * Tests for the Kalshi public client.
 *
 * Three behaviours are non-obvious enough to be worth pinning down:
 *  - the token-bucket pacing actually waits between requests,
 *  - transient failures (429 / 5xx / network) are retried with exponential
 *    backoff, and terminal failures (404 / 403) are not,
 *  - bodies are Zod-validated, so a shape change at Kalshi fails loudly here
 *    rather than corrupting downstream data.
 *
 * Every test injects a mock `fetch` and a no-op `sleep`, so they run instantly.
 */

/** JSON `Response` factory — keeps the test bodies short. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Minimal `markets` page body that satisfies `KalshiMarketsResponseSchema`. */
const oneMarketPage = (cursor: string | null = null) => ({
  markets: [
    {
      ticker: 'TEST-1',
      event_ticker: 'EV-1',
      title: 'A market',
      status: 'active',
      yes_bid_dollars: '0.50',
      yes_ask_dollars: '0.55',
    },
  ],
  cursor,
});

/* -------------------------------------------------------------------------- */

describe('KalshiPublicClient — rate limiting', () => {
  it('paces successive requests through the token bucket', async () => {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    const fetchImpl = vi.fn(async () => jsonResponse(oneMarketPage()));

    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      // Tiny bucket: capacity 1 forces the second call to wait.
      rateLimit: { capacity: 1, refillPerSec: 1 },
    });

    await client.getMarkets();
    await client.getMarkets();

    // Two requests, two fetches; the second `acquire` waited at least once.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps.length).toBeGreaterThan(0);
  });
});

describe('KalshiPublicClient — retries / backoff', () => {
  it('retries 5xx responses and eventually succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'oh no' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'oh no' }, 503))
      .mockResolvedValueOnce(jsonResponse(oneMarketPage()));

    const sleep = vi.fn(async () => undefined);
    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
    });

    const result = await client.getMarkets();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Two retry delays preceded the third (successful) attempt.
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.markets).toHaveLength(1);
  });

  it('retries 429 (rate limited) responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'slow down' }, 429))
      .mockResolvedValueOnce(jsonResponse(oneMarketPage()));

    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const result = await client.getMarkets();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.markets).toHaveLength(1);
  });

  it('does not retry terminal 4xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'gone' }, 404));
    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(client.getMarket('NOPE')).rejects.toBeInstanceOf(KalshiApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries network failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse(oneMarketPage()));

    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const result = await client.getMarkets();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.markets).toHaveLength(1);
  });

  it('gives up after exhausting the retry budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 503));
    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
      backoff: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 },
    });

    await expect(client.getMarkets()).rejects.toBeInstanceOf(KalshiApiError);
    // 1 initial attempt + 2 retries = 3 total.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('KalshiPublicClient — Zod validation', () => {
  it('throws on a malformed response shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ wrong: 'shape' }));
    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(client.getMarkets()).rejects.toBeInstanceOf(KalshiApiError);
    // Shape errors are terminal — no retry.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('KalshiPublicClient — pagination', () => {
  it('follows the cursor in getAllMarkets', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(oneMarketPage('cursor-1')))
      .mockResolvedValueOnce(jsonResponse({ ...oneMarketPage(), markets: [{
        ticker: 'TEST-2',
        title: 'A market 2',
        status: 'active',
      }] }));

    const client = new KalshiPublicClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const all = await client.getAllMarkets({ pageSize: 1, maxPages: 5 });
    expect(all).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
