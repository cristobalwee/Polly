import type { KalshiEnvironment } from '@polly/shared';
import type { ZodType } from 'zod';
import { TokenBucket } from './rate-limiter';
import {
  KalshiCandlesticksResponseSchema,
  KalshiEventsResponseSchema,
  KalshiMarketResponseSchema,
  KalshiMarketsResponseSchema,
  KalshiOrderbookResponseSchema,
  type KalshiCandlestick,
  type KalshiEvent,
  type KalshiMarket,
  type KalshiOrderbook,
} from './schemas';

/**
 * Typed client for Kalshi's *public* market-data endpoints.
 *
 * Public endpoints need no authentication, so this client carries no key — it
 * is the unauthenticated counterpart to `validateKalshiCredentials` in
 * `client.ts`. What it does carry:
 *
 *  - **Rate limiting** — every request waits on a shared `TokenBucket` sized to
 *    Kalshi's published per-second read limit, so we pace ourselves rather than
 *    relying on 429s.
 *  - **Exponential backoff** — transient failures (429, 5xx, network errors)
 *    are retried with exponential delay + jitter; 4xx other than 429 are not
 *    retried, since they will never succeed.
 *  - **Validation** — every response body is parsed through a Zod schema, so a
 *    Kalshi shape change fails loudly at the boundary.
 */

const BASE_URLS: Record<KalshiEnvironment, string> = {
  demo: 'https://demo-api.kalshi.co/trade-api/v2',
  production: 'https://api.elections.kalshi.com/trade-api/v2',
};

/**
 * Kalshi's read rate limit on the entry-level tier is ~10 requests/second.
 * We pace at 8/s with a small burst to leave headroom for clock skew and any
 * other caller sharing the process.
 */
const DEFAULT_RATE = { capacity: 8, refillPerSec: 8 } as const;

/** Backoff tuning: retry budget and the exponential delay envelope. */
interface BackoffConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Backoff: up to 4 retries, starting at 500ms and doubling, capped at 8s. */
const DEFAULT_BACKOFF: BackoffConfig = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/** Raised when a Kalshi request ultimately fails (after any retries). */
export class KalshiApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or `undefined` for a transport-level failure. */
    readonly status?: number,
    /** `true` if the failure is the kind a retry could have fixed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'KalshiApiError';
  }
}

type Primitive = string | number | boolean | undefined | null;

export interface KalshiPublicClientOptions {
  environment?: KalshiEnvironment;
  /** Injectable `fetch` — tests pass a mock; production uses global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep — tests pass a no-op to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
  rateLimit?: { capacity: number; refillPerSec: number };
  backoff?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
}

export class KalshiPublicClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly bucket: TokenBucket;
  private readonly backoff: BackoffConfig;

  constructor(opts: KalshiPublicClientOptions = {}) {
    this.baseUrl = BASE_URLS[opts.environment ?? 'demo'];
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.bucket = new TokenBucket({
      ...DEFAULT_RATE,
      ...opts.rateLimit,
      sleep: this.sleep,
    });
  }

  /* ----------------------------- HTTP plumbing ---------------------------- */

  /** Build a URL with query params, dropping `undefined`/`null` values. */
  private url(path: string, query?: Record<string, Primitive>): string {
    const u = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /** Delay before retry `attempt` (0-indexed): exponential, jittered, capped. */
  private retryDelay(attempt: number): number {
    const exp = this.backoff.baseDelayMs * 2 ** attempt;
    const capped = Math.min(exp, this.backoff.maxDelayMs);
    // Full jitter — spread retries so concurrent callers don't resynchronise.
    return Math.round(Math.random() * capped);
  }

  /**
   * Fetch `path`, retrying transient failures with exponential backoff, then
   * validate the JSON body against `schema`. Each attempt first acquires a
   * rate-limit token.
   */
  private async request<T>(
    path: string,
    schema: ZodType<T>,
    query?: Record<string, Primitive>,
  ): Promise<T> {
    const target = this.url(path, query);
    let lastError: KalshiApiError = new KalshiApiError(`Kalshi request failed: ${path}`);

    for (let attempt = 0; attempt <= this.backoff.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryDelay(attempt - 1));
      await this.bucket.acquire();

      let res: Response;
      try {
        res = await this.fetchImpl(target, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
      } catch (err) {
        // Network/transport failure — always retryable.
        lastError = new KalshiApiError(
          `Could not reach Kalshi: ${err instanceof Error ? err.message : 'network error'}`,
          undefined,
          true,
        );
        continue;
      }

      if (res.ok) {
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new KalshiApiError(`Kalshi returned a non-JSON body for ${path}`, res.status);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          // A shape mismatch will not fix itself on retry — fail hard.
          throw new KalshiApiError(
            `Kalshi response for ${path} failed validation: ${parsed.error.message}`,
            res.status,
          );
        }
        return parsed.data;
      }

      // 429 and 5xx are transient; everything else (400/403/404…) is terminal.
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new KalshiApiError(
        `Kalshi responded ${res.status} for ${path}`,
        res.status,
        retryable,
      );
      if (!retryable) throw lastError;
    }

    throw lastError;
  }

  /* ------------------------------ Endpoints ------------------------------- */

  /** `GET /events` — one page of events. */
  async getEvents(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
  }): Promise<{ events: KalshiEvent[]; cursor: string | null }> {
    const res = await this.request('/events', KalshiEventsResponseSchema, {
      limit: params?.limit,
      cursor: params?.cursor,
      status: params?.status,
    });
    return { events: res.events, cursor: res.cursor ?? null };
  }

  /** `GET /markets` — one page of markets. `status` is a Kalshi status string. */
  async getMarkets(params?: {
    limit?: number;
    cursor?: string;
    status?: string;
    eventTicker?: string;
  }): Promise<{ markets: KalshiMarket[]; cursor: string | null }> {
    const res = await this.request('/markets', KalshiMarketsResponseSchema, {
      limit: params?.limit,
      cursor: params?.cursor,
      status: params?.status,
      event_ticker: params?.eventTicker,
    });
    return { markets: res.markets, cursor: res.cursor ?? null };
  }

  /**
   * Page through `GET /markets` until the cursor runs out, collecting every
   * market. `maxPages` is a safety cap so a misbehaving cursor cannot spin
   * forever.
   */
  async getAllMarkets(params?: {
    status?: string;
    pageSize?: number;
    maxPages?: number;
  }): Promise<KalshiMarket[]> {
    const pageSize = params?.pageSize ?? 200;
    const maxPages = params?.maxPages ?? 50;
    const all: KalshiMarket[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const { markets, cursor: next } = await this.getMarkets({
        limit: pageSize,
        cursor,
        status: params?.status,
      });
      all.push(...markets);
      if (!next || markets.length === 0) break;
      cursor = next;
    }
    return all;
  }

  /** `GET /markets/{ticker}` — a single market. */
  async getMarket(ticker: string): Promise<KalshiMarket> {
    const res = await this.request(
      `/markets/${encodeURIComponent(ticker)}`,
      KalshiMarketResponseSchema,
    );
    return res.market;
  }

  /** `GET /markets/{ticker}/orderbook` — resting bids on each side. */
  async getOrderbook(ticker: string, depth?: number): Promise<KalshiOrderbook> {
    const res = await this.request(
      `/markets/${encodeURIComponent(ticker)}/orderbook`,
      KalshiOrderbookResponseSchema,
      { depth },
    );
    return res.orderbook;
  }

  /**
   * `GET /markets/{ticker}/candlesticks` — historical OHLC candles.
   * `startTs` / `endTs` are Unix epoch seconds; `periodInterval` is in minutes.
   */
  async getCandlesticks(
    ticker: string,
    params?: { startTs?: number; endTs?: number; periodInterval?: number },
  ): Promise<KalshiCandlestick[]> {
    const res = await this.request(
      `/markets/${encodeURIComponent(ticker)}/candlesticks`,
      KalshiCandlesticksResponseSchema,
      {
        start_ts: params?.startTs,
        end_ts: params?.endTs,
        period_interval: params?.periodInterval,
      },
    );
    return res.candlesticks;
  }
}
