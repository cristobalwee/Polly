import { constants, sign } from 'node:crypto';
import type { KalshiEnvironment } from '@polly/shared';
import type { ZodType } from 'zod';
import {
  KalshiBalanceResponseSchema,
  KalshiFillsResponseSchema,
  KalshiOrdersResponseSchema,
  KalshiPositionsResponseSchema,
  type KalshiBalanceResponse,
  type KalshiFill,
  type KalshiMarketPosition,
  type KalshiOrder,
} from './private-schemas';
import { TokenBucket } from './rate-limiter';

/**
 * Authenticated Kalshi API client — one instance *per user*.
 *
 * Kalshi authenticates each request with an RSA key pair: the caller signs
 * `timestamp + method + path` (where `path` includes the `/trade-api/v2`
 * prefix) with the user's private key using RSA-PSS / SHA-256, and sends the
 * signature, the public key id, and the timestamp in three headers. The
 * matching unauthenticated probe lives in `client.ts`; this client is the
 * production read path the `TradesPoller` uses.
 *
 * Like the public client, it carries:
 *
 *  - **Per-instance rate limiting** — Kalshi limits per *key*, so each user
 *    has their own token bucket. We pace conservatively (8 req/s).
 *  - **Exponential backoff** — 429 / 5xx / transport failures retry; 4xx
 *    other than 429 fail fast.
 *  - **Zod-validated bodies** — a shape drift at Kalshi fails at the boundary,
 *    not deep in `private-normalise.ts`.
 *  - **A typed credential-rejected error** — so the poller can pause this
 *    user's loop and mark the credential `invalid` without paying more retries.
 */

const BASE_URLS: Record<KalshiEnvironment, string> = {
  demo: 'https://demo-api.kalshi.co/trade-api/v2',
  production: 'https://api.elections.kalshi.com/trade-api/v2',
};

/** All Kalshi paths sit under this prefix and must be present in the signature. */
const PATH_PREFIX = '/trade-api/v2';

/** Per-key request rate. Conservative — leaves headroom for clock skew. */
const DEFAULT_RATE = { capacity: 8, refillPerSec: 8 } as const;

interface BackoffConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_BACKOFF: BackoffConfig = {
  maxRetries: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

/** Thrown when Kalshi rejects authentication — caller must mark the key invalid. */
export class KalshiAuthError extends Error {
  constructor(
    message: string,
    /** HTTP status (always 401 or 403). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'KalshiAuthError';
  }
}

/** Thrown when Kalshi ultimately fails for some non-auth reason. */
export class KalshiPrivateApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'KalshiPrivateApiError';
  }
}

type Primitive = string | number | boolean | undefined | null;

export interface KalshiPrivateClientOptions {
  /** Kalshi-issued public key id, sent verbatim as `KALSHI-ACCESS-KEY`. */
  keyId: string;
  /** RSA private key, PEM-encoded. Never logged. */
  privateKeyPem: string;
  environment?: KalshiEnvironment;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rateLimit?: { capacity: number; refillPerSec: number };
  backoff?: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  /** Injectable clock — tests pin time for deterministic signatures. */
  now?: () => number;
}

/* -------------------------------------------------------------------------- */
/*  Request signing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Sign `timestamp + method + signedPath` with the user's RSA private key
 * (RSA-PSS, SHA-256, salt length = digest). Identical algorithm to
 * `client.ts` — kept inline rather than imported so the auth client and the
 * validation probe stay independently testable.
 */
function signRequest(
  privateKeyPem: string,
  timestamp: string,
  method: string,
  signedPath: string,
): string {
  const message = `${timestamp}${method}${signedPath}`;
  return sign('sha256', Buffer.from(message), {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

/* -------------------------------------------------------------------------- */
/*  The client                                                                  */
/* -------------------------------------------------------------------------- */

export class KalshiPrivateClient {
  private readonly baseUrl: string;
  private readonly keyId: string;
  private readonly privateKeyPem: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly bucket: TokenBucket;
  private readonly backoff: BackoffConfig;
  private readonly now: () => number;

  constructor(opts: KalshiPrivateClientOptions) {
    this.baseUrl = BASE_URLS[opts.environment ?? 'demo'];
    this.keyId = opts.keyId;
    this.privateKeyPem = opts.privateKeyPem;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.backoff = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.now = opts.now ?? Date.now;
    this.bucket = new TokenBucket({
      ...DEFAULT_RATE,
      ...opts.rateLimit,
      sleep: this.sleep,
    });
  }

  /* ------------------------------- Internals ------------------------------ */

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
    return Math.round(Math.random() * capped);
  }

  /**
   * Build the three Kalshi signing headers. The signed path includes the
   * `/trade-api/v2` prefix and the request path *without* the query string —
   * Kalshi's signature scheme only covers `timestamp + method + path`.
   */
  private signHeaders(method: string, path: string): Record<string, string> {
    const timestamp = String(this.now());
    const signedPath = `${PATH_PREFIX}${path}`;
    const signature = signRequest(this.privateKeyPem, timestamp, method, signedPath);
    return {
      'KALSHI-ACCESS-KEY': this.keyId,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      Accept: 'application/json',
    };
  }

  /**
   * One GET request with retry, rate limiting, signing, and Zod validation.
   * Throws `KalshiAuthError` on 401/403 — these never retry. Throws
   * `KalshiPrivateApiError` on every other failure once the retry budget is
   * exhausted.
   */
  private async request<T>(
    path: string,
    schema: ZodType<T>,
    query?: Record<string, Primitive>,
  ): Promise<T> {
    const target = this.url(path, query);
    const method = 'GET';
    let lastError: KalshiPrivateApiError = new KalshiPrivateApiError(
      `Kalshi request failed: ${path}`,
    );

    for (let attempt = 0; attempt <= this.backoff.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryDelay(attempt - 1));
      await this.bucket.acquire();

      let res: Response;
      try {
        // A fresh timestamp + signature per attempt — Kalshi rejects timestamps
        // outside a small clock-skew window, and a retry may be far enough out
        // for that to matter.
        res = await this.fetchImpl(target, {
          method,
          headers: this.signHeaders(method, path),
        });
      } catch (err) {
        lastError = new KalshiPrivateApiError(
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
          throw new KalshiPrivateApiError(
            `Kalshi returned a non-JSON body for ${path}`,
            res.status,
          );
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new KalshiPrivateApiError(
            `Kalshi response for ${path} failed validation: ${parsed.error.message}`,
            res.status,
          );
        }
        return parsed.data;
      }

      // Auth rejections never recover — surface a typed error so the poller
      // can mark the credential invalid and stop polling this user.
      if (res.status === 401 || res.status === 403) {
        throw new KalshiAuthError(
          `Kalshi rejected the credential (HTTP ${res.status})`,
          res.status,
        );
      }

      const retryable = res.status === 429 || res.status >= 500;
      lastError = new KalshiPrivateApiError(
        `Kalshi responded ${res.status} for ${path}`,
        res.status,
        retryable,
      );
      if (!retryable) throw lastError;
    }

    throw lastError;
  }

  /* ------------------------------ Endpoints ------------------------------- */

  /** `GET /portfolio/balance`. */
  async getBalance(): Promise<KalshiBalanceResponse> {
    return this.request('/portfolio/balance', KalshiBalanceResponseSchema);
  }

  /**
   * `GET /portfolio/positions` — pages through every market position. Kalshi
   * caps results per page; we follow `cursor` until exhausted.
   */
  async getAllPositions(): Promise<KalshiMarketPosition[]> {
    const out: KalshiMarketPosition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.request(
        '/portfolio/positions',
        KalshiPositionsResponseSchema,
        { cursor, limit: 200 },
      );
      const items = res.market_positions ?? [];
      out.push(...items);
      if (!res.cursor || items.length === 0) break;
      cursor = res.cursor;
    }
    return out;
  }

  /**
   * `GET /portfolio/fills` — one page. `minTs` (epoch seconds) lets the
   * caller ask only for fills newer than the last one ingested.
   */
  async getFills(params?: {
    cursor?: string;
    limit?: number;
    minTs?: number;
  }): Promise<{ fills: KalshiFill[]; cursor: string | null }> {
    const res = await this.request(
      '/portfolio/fills',
      KalshiFillsResponseSchema,
      {
        cursor: params?.cursor,
        limit: params?.limit ?? 100,
        min_ts: params?.minTs,
      },
    );
    return { fills: res.fills ?? [], cursor: res.cursor ?? null };
  }

  /**
   * Page through `/portfolio/fills` until exhausted, collecting every fill
   * newer than `minTs` (epoch seconds). `maxPages` caps a runaway cursor.
   */
  async getAllFills(params?: {
    minTs?: number;
    pageSize?: number;
    maxPages?: number;
  }): Promise<KalshiFill[]> {
    const pageSize = params?.pageSize ?? 100;
    const maxPages = params?.maxPages ?? 200;
    const all: KalshiFill[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { fills, cursor: next } = await this.getFills({
        cursor,
        limit: pageSize,
        minTs: params?.minTs,
      });
      all.push(...fills);
      if (!next || fills.length === 0) break;
      cursor = next;
    }
    return all;
  }

  /** `GET /portfolio/orders` — only resting orders are surfaced here. */
  async getAllOrders(): Promise<KalshiOrder[]> {
    const out: KalshiOrder[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.request(
        '/portfolio/orders',
        KalshiOrdersResponseSchema,
        { cursor, limit: 200, status: 'resting' },
      );
      const items = res.orders ?? [];
      out.push(...items);
      if (!res.cursor || items.length === 0) break;
      cursor = res.cursor;
    }
    return out;
  }
}
