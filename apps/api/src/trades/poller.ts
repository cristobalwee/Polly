import { and, eq, inArray, sql } from 'drizzle-orm';
import { envelope } from '../crypto/secrets';
import { db as defaultDb, type Database } from '../db/client';
import {
  markets,
  orders,
  positions,
  trades,
  userBalances,
  userKalshiCredentials,
  type MarketInsert,
  type OrderInsert,
  type PositionInsert,
  type TradeInsert,
  type TradeRow,
  type UserKalshiCredentialRow,
} from '../db/schema';
import type { KalshiEnvironment } from '@polly/shared';
import { KalshiAuthError, KalshiPrivateClient } from '../kalshi/private-client';
import type { KalshiPublicClient } from '../kalshi/public-client';
import type { KalshiMarket } from './../kalshi/schemas';
import {
  balanceCents,
  normaliseFill,
  normaliseOrder,
  normalisePosition,
  type NormalisedFill,
} from '../kalshi/private-normalise';
import {
  marketPrices,
  marketVolumes,
  normaliseStatus,
  resolutionDate,
  yesMidCents,
} from '../kalshi/normalise';
import { loadCategoriser, type Categoriser } from '../markets/categorization';
import { matchFifo, type FifoTrade } from './realized-pnl';

/**
 * Per-user background worker that mirrors each connected user's Kalshi state
 * into polly: balance, positions, fills (→ trades), and resting orders.
 *
 * Architecture:
 *
 *  - The poller wakes on a single timer (every 2 minutes by default) and
 *    enqueues a sync for every user whose Kalshi credential is `valid`. A
 *    fixed-size worker pool (10 by default) drains the queue, so we never
 *    blow Kalshi's per-key rate limits and a slow user can't starve the rest.
 *  - Each user's sync is **independent** — a 401 for user A flips A's
 *    `validation_status` to `invalid` and skips them next cycle, but B's loop
 *    continues unimpeded.
 *  - **Backfill on first connection:** `user_kalshi_credentials.lastFillExecutedAt`
 *    is the cursor; `null` means "fetch every historical fill", a date means
 *    "fetch only fills newer than this". Either way we page until the cursor
 *    is exhausted.
 *  - **Idempotency**: trade ingestion is upsert-on-conflict by `(user_id,
 *    kalshi_trade_id)`, so re-runs are safe. Positions are replaced wholesale
 *    per user per poll — Kalshi is the source of truth.
 *  - **Realised P&L** is recomputed by replaying every trade for each
 *    affected `(user, ticker, side)` slice through the pure FIFO matcher in
 *    `realized-pnl.ts`. Replay (rather than incremental update) is the only
 *    correct strategy when a backfill can deliver an older fill *after* a
 *    newer one has been ingested.
 *
 * The poller is testable: the timer is bypassable, `syncUser` is public, and
 * the Kalshi clients are injected — see `poller.test.ts`.
 */

/** A minimal logger — same shape as `MarketsPoller`'s. */
export interface TradesPollerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const tradesConsoleLogger: TradesPollerLogger = {
  info: (m, meta) => console.log(`[trades-poller] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[trades-poller] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[trades-poller] ${m}`, meta ?? ''),
};

/**
 * Factory for the per-user authenticated client. Injectable so tests can hand
 * back a mock keyed on `userId` without touching real RSA signing.
 */
export type PrivateClientFactory = (cred: {
  userId: string;
  keyId: string;
  privateKeyPem: string;
  environment: KalshiEnvironment;
}) => KalshiPrivateClient;

export interface TradesPollerOptions {
  /** Public market-data client — used to backfill missing market rows. */
  publicClient: KalshiPublicClient;
  /** Optional override; defaults to constructing a real `KalshiPrivateClient`. */
  privateClientFactory?: PrivateClientFactory;
  database?: Database;
  logger?: TradesPollerLogger;
  /** Tick cadence (ms). Default 2 minutes. */
  pollIntervalMs?: number;
  /** How many users to sync in parallel. Default 10. */
  concurrency?: number;
}

/** Result returned by `syncUser` — useful for the manual-sync endpoint. */
export interface SyncResult {
  userId: string;
  status: 'ok' | 'invalid-credentials' | 'error';
  fills: number;
  positions: number;
  orders: number;
  balanceCents: number;
  durationMs: number;
  error?: string;
}

const TWO_MIN = 2 * 60_000;

export class TradesPoller {
  private readonly publicClient: KalshiPublicClient;
  private readonly privateClientFactory: PrivateClientFactory;
  private readonly db: Database;
  private readonly log: TradesPollerLogger;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;

  private timer: NodeJS.Timeout | null = null;
  /** Top-level in-flight guard for the every-2-min tick. */
  private tickInFlight = false;
  /** Per-user in-flight guard — manual + scheduled syncs can race. */
  private readonly userInFlight = new Set<string>();

  constructor(opts: TradesPollerOptions) {
    this.publicClient = opts.publicClient;
    this.privateClientFactory =
      opts.privateClientFactory ??
      ((cred) =>
        new KalshiPrivateClient({
          keyId: cred.keyId,
          privateKeyPem: cred.privateKeyPem,
          environment: cred.environment,
        }));
    this.db = opts.database ?? defaultDb;
    this.log = opts.logger ?? tradesConsoleLogger;
    this.pollIntervalMs = opts.pollIntervalMs ?? TWO_MIN;
    this.concurrency = Math.max(1, opts.concurrency ?? 10);
  }

  /* ------------------------------ Lifecycle ------------------------------- */

  /** Kick a sync immediately, then schedule the recurring loop. */
  async start(): Promise<void> {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.log.info('trades poller started', {
      pollIntervalMs: this.pollIntervalMs,
      concurrency: this.concurrency,
    });
  }

  /** Stop the recurring loop. Safe to call more than once. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* --------------------------- Top-level cadence -------------------------- */

  /**
   * One full tick: collect every user with a `valid` credential, sync each
   * through the worker pool. Never throws — per-user errors are isolated.
   */
  async tick(): Promise<void> {
    if (this.tickInFlight) {
      this.log.warn('tick skipped — previous tick still running');
      return;
    }
    this.tickInFlight = true;
    const startedAt = Date.now();
    try {
      const credentials = await this.loadActiveCredentials();
      if (credentials.length === 0) {
        this.log.info('tick: no active credentials', { ms: Date.now() - startedAt });
        return;
      }
      await this.runPool(credentials);
      this.log.info('tick ok', {
        users: credentials.length,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      this.log.error('tick failed', { error: errMessage(err) });
    } finally {
      this.tickInFlight = false;
    }
  }

  /**
   * Drain `credentials` through a fixed worker pool. Each worker pulls the
   * next credential off the shared cursor and runs `syncUserWith` to
   * completion before pulling again.
   */
  private async runPool(credentials: UserKalshiCredentialRow[]): Promise<void> {
    let cursor = 0;
    const next = () => (cursor < credentials.length ? credentials[cursor++] : undefined);

    const worker = async () => {
      for (;;) {
        const cred = next();
        if (!cred) return;
        try {
          await this.syncUserWith(cred);
        } catch (err) {
          // Individual user errors must not abort the pool.
          this.log.error('user sync threw', {
            userId: cred.userId,
            error: errMessage(err),
          });
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, credentials.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  /* --------------------------- Manual sync entry -------------------------- */

  /**
   * Sync one user immediately. Used by `POST /trades/sync`. Returns a
   * structured result so the API can surface a useful toast on the client.
   *
   * Always loads the credential fresh from the database — we never trust a
   * cached one because validation status changes underneath us.
   */
  async syncUser(userId: string): Promise<SyncResult> {
    const startedAt = Date.now();
    const cred = await this.findCredential(userId);
    if (!cred) {
      return {
        userId,
        status: 'error',
        fills: 0,
        positions: 0,
        orders: 0,
        balanceCents: 0,
        durationMs: Date.now() - startedAt,
        error: 'No Kalshi credential connected',
      };
    }
    if (cred.validationStatus === 'invalid') {
      return {
        userId,
        status: 'invalid-credentials',
        fills: 0,
        positions: 0,
        orders: 0,
        balanceCents: 0,
        durationMs: Date.now() - startedAt,
        error: 'Kalshi credential is marked invalid — re-validate from Settings',
      };
    }
    return this.syncUserWith(cred);
  }

  /* --------------------------- Per-user sync core ------------------------- */

  /**
   * Sync one user end-to-end: balance, positions, fills (+ realised P&L),
   * orders. Decrypts the private key in memory, never logs it, and discards
   * it as soon as the call returns.
   */
  private async syncUserWith(cred: UserKalshiCredentialRow): Promise<SyncResult> {
    if (this.userInFlight.has(cred.userId)) {
      // Manual + scheduled syncs raced — let the in-flight one win.
      return {
        userId: cred.userId,
        status: 'ok',
        fills: 0,
        positions: 0,
        orders: 0,
        balanceCents: 0,
        durationMs: 0,
      };
    }
    this.userInFlight.add(cred.userId);
    const startedAt = Date.now();

    let privateKeyPem: string;
    try {
      privateKeyPem = envelope
        .open({
          ciphertext: cred.encryptedPrivateKey,
          encryptedDek: cred.encryptedDek,
          iv: cred.iv,
          authTag: cred.authTag,
        })
        .toString('utf8');
    } catch (err) {
      this.userInFlight.delete(cred.userId);
      this.log.error('credential decrypt failed', {
        userId: cred.userId,
        error: errMessage(err),
      });
      return {
        userId: cred.userId,
        status: 'error',
        fills: 0,
        positions: 0,
        orders: 0,
        balanceCents: 0,
        durationMs: Date.now() - startedAt,
        error: 'Could not decrypt Kalshi credential',
      };
    }

    const client = this.privateClientFactory({
      userId: cred.userId,
      keyId: cred.keyId,
      privateKeyPem,
      environment: cred.environment as KalshiEnvironment,
    });

    try {
      const balance = await client.getBalance();
      const balanceVal = balanceCents(balance);
      await this.upsertBalance(cred.userId, balanceVal);

      const positionsCount = await this.syncPositions(cred.userId, client);
      const fillsCount = await this.syncFills(cred, client);
      const ordersCount = await this.syncOrders(cred.userId, client);

      await this.db
        .update(userKalshiCredentials)
        .set({ lastPolledAt: new Date() })
        .where(eq(userKalshiCredentials.userId, cred.userId));

      return {
        userId: cred.userId,
        status: 'ok',
        fills: fillsCount,
        positions: positionsCount,
        orders: ordersCount,
        balanceCents: balanceVal,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err instanceof KalshiAuthError) {
        // The user's key no longer works — flip status and back off.
        await this.db
          .update(userKalshiCredentials)
          .set({ validationStatus: 'invalid', lastValidatedAt: new Date() })
          .where(eq(userKalshiCredentials.userId, cred.userId));
        this.log.warn('credential rejected by kalshi', { userId: cred.userId });
        return {
          userId: cred.userId,
          status: 'invalid-credentials',
          fills: 0,
          positions: 0,
          orders: 0,
          balanceCents: 0,
          durationMs: Date.now() - startedAt,
          error: 'Kalshi rejected the credential',
        };
      }
      this.log.error('user sync failed', {
        userId: cred.userId,
        error: errMessage(err),
      });
      return {
        userId: cred.userId,
        status: 'error',
        fills: 0,
        positions: 0,
        orders: 0,
        balanceCents: 0,
        durationMs: Date.now() - startedAt,
        error: errMessage(err),
      };
    } finally {
      this.userInFlight.delete(cred.userId);
    }
  }

  /* ----------------------------- Sub-syncs ------------------------------- */

  /** Upsert one row in `user_balances`. */
  private async upsertBalance(userId: string, cents: number): Promise<void> {
    await this.db
      .insert(userBalances)
      .values({ userId, balanceCents: cents, lastUpdatedAt: new Date() })
      .onConflictDoUpdate({
        target: userBalances.userId,
        set: {
          balanceCents: sql`excluded.balance_cents`,
          lastUpdatedAt: sql`excluded.last_updated_at`,
        },
      });
  }

  /**
   * Replace the user's positions wholesale: fetch every open position from
   * Kalshi, ensure each ticker is in `markets`, upsert positions, delete any
   * positions for that user *not* in the new set (i.e. closed positions).
   */
  private async syncPositions(
    userId: string,
    client: KalshiPrivateClient,
  ): Promise<number> {
    const raw = await client.getAllPositions();
    const normalised = raw
      .map(normalisePosition)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    await this.ensureMarkets(normalised.map((p) => p.ticker));

    if (normalised.length === 0) {
      await this.db.delete(positions).where(eq(positions.userId, userId));
      return 0;
    }

    const rows: PositionInsert[] = normalised.map((p) => ({
      userId,
      ticker: p.ticker,
      side: p.side,
      count: p.count,
      averageCostCents: p.averageCostCents,
      marketExposureCents: p.marketExposureCents,
      realizedPnlCents: p.realizedPnlCents,
      // We re-derive unrealised P&L on read; keep the column at 0 for storage.
      unrealizedPnlCents: 0,
      lastUpdatedAt: new Date(),
    }));

    await this.db
      .insert(positions)
      .values(rows)
      .onConflictDoUpdate({
        target: [positions.userId, positions.ticker, positions.side],
        set: {
          count: sql`excluded.count`,
          averageCostCents: sql`excluded.average_cost_cents`,
          marketExposureCents: sql`excluded.market_exposure_cents`,
          realizedPnlCents: sql`excluded.realized_pnl_cents`,
          unrealizedPnlCents: sql`excluded.unrealized_pnl_cents`,
          lastUpdatedAt: sql`excluded.last_updated_at`,
        },
      });

    // Delete positions that disappeared from Kalshi (closed since last poll).
    const liveKeys = new Set(normalised.map((p) => `${p.ticker}|${p.side}`));
    const existing = await this.db
      .select({ ticker: positions.ticker, side: positions.side, id: positions.id })
      .from(positions)
      .where(eq(positions.userId, userId));
    const toDelete = existing
      .filter((e) => !liveKeys.has(`${e.ticker}|${e.side}`))
      .map((e) => e.id);
    if (toDelete.length > 0) {
      await this.db.delete(positions).where(inArray(positions.id, toDelete));
    }
    return normalised.length;
  }

  /**
   * Fetch new fills (backfill or incremental), insert into `trades`, then
   * recompute realised P&L for every affected `(ticker, side)` slice. Returns
   * the count of newly-inserted trades.
   */
  private async syncFills(
    cred: UserKalshiCredentialRow,
    client: KalshiPrivateClient,
  ): Promise<number> {
    const minTs = cred.lastFillExecutedAt
      ? Math.floor(cred.lastFillExecutedAt.getTime() / 1000)
      : undefined;
    const raw = await client.getAllFills({ minTs });
    const normalised = raw
      .map(normaliseFill)
      .filter((f): f is NormalisedFill => f !== null);

    if (normalised.length === 0) return 0;

    await this.ensureMarkets(normalised.map((f) => f.ticker));

    // Upsert each trade — unique on (user_id, kalshi_trade_id) makes this
    // safe across reruns of the same window.
    const rows: TradeInsert[] = normalised.map((f) => ({
      userId: cred.userId,
      kalshiTradeId: f.kalshiTradeId,
      ticker: f.ticker,
      side: f.side,
      action: f.action,
      count: f.count,
      priceCents: f.priceCents,
      feeCents: f.feeCents,
      // Provisional — recomputed below by FIFO replay across the whole slice.
      realizedPnlCents: null,
      executedAt: f.executedAt,
    }));

    // Use ON CONFLICT DO NOTHING for the initial insert so we don't trample a
    // realised_pnl already computed for an existing row; the FIFO recompute
    // below rewrites realised_pnl for every affected slice anyway.
    await this.db.insert(trades).values(rows).onConflictDoNothing({
      target: [trades.userId, trades.kalshiTradeId],
    });

    // Recompute realised P&L for every (ticker, side) we just touched. This
    // is safe to do per slice because YES and NO are independent instruments
    // and one user's fills never overlap with another's.
    const affected = new Map<string, { ticker: string; side: 'yes' | 'no' }>();
    for (const f of normalised) {
      affected.set(`${f.ticker}|${f.side}`, { ticker: f.ticker, side: f.side });
    }
    for (const slice of affected.values()) {
      await this.recomputeRealizedPnl(cred.userId, slice.ticker, slice.side);
    }

    // Advance the cursor to the latest fill we saw. We intentionally do not
    // advance it past *failed* slices — but the slice work above either
    // succeeds or throws, so reaching here means all slices were processed.
    const latest = normalised.reduce<Date>(
      (acc, f) => (f.executedAt > acc ? f.executedAt : acc),
      new Date(0),
    );
    await this.db
      .update(userKalshiCredentials)
      .set({ lastFillExecutedAt: latest })
      .where(eq(userKalshiCredentials.userId, cred.userId));

    return normalised.length;
  }

  /**
   * Replay every trade for one `(user, ticker, side)` slice through FIFO,
   * then UPDATE the per-trade `realized_pnl_cents` column. Idempotent: re-run
   * after a backfill yields the same answer.
   */
  private async recomputeRealizedPnl(
    userId: string,
    ticker: string,
    side: 'yes' | 'no',
  ): Promise<void> {
    const sliceRows: Pick<TradeRow, 'id' | 'action' | 'count' | 'priceCents' | 'executedAt'>[] =
      await this.db
        .select({
          id: trades.id,
          action: trades.action,
          count: trades.count,
          priceCents: trades.priceCents,
          executedAt: trades.executedAt,
        })
        .from(trades)
        .where(
          and(eq(trades.userId, userId), eq(trades.ticker, ticker), eq(trades.side, side)),
        );

    const fifoInput: FifoTrade[] = sliceRows.map((r) => ({
      id: r.id,
      action: r.action === 'sell' ? 'sell' : 'buy',
      count: r.count,
      priceCents: r.priceCents,
      executedAt: r.executedAt,
    }));
    const { realizedByTradeId } = matchFifo(fifoInput);

    // Update each trade row: closing trades get a number, opening trades get
    // null. We issue per-row UPDATEs in a transaction — Postgres handles
    // hundreds easily and the slice is per-(ticker, side) so the working set
    // is always small.
    if (sliceRows.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const r of sliceRows) {
        const realized = realizedByTradeId.has(r.id)
          ? realizedByTradeId.get(r.id)!
          : null;
        await tx
          .update(trades)
          .set({ realizedPnlCents: realized })
          .where(eq(trades.id, r.id));
      }
    });
  }

  /**
   * Replace the user's resting orders. Kalshi only returns resting (live)
   * orders here, so anything in our table that isn't in the response has
   * either filled (→ a `trades` row) or been cancelled.
   */
  private async syncOrders(
    userId: string,
    client: KalshiPrivateClient,
  ): Promise<number> {
    const raw = await client.getAllOrders();
    const normalised = raw
      .map(normaliseOrder)
      .filter((o): o is NonNullable<typeof o> => o !== null);

    if (normalised.length === 0) {
      await this.db.delete(orders).where(eq(orders.userId, userId));
      return 0;
    }

    await this.ensureMarkets(normalised.map((o) => o.ticker));

    const rows: OrderInsert[] = normalised.map((o) => ({
      userId,
      kalshiOrderId: o.kalshiOrderId,
      ticker: o.ticker,
      side: o.side,
      action: o.action,
      count: o.count,
      remainingCount: o.remainingCount,
      priceCents: o.priceCents,
      status: o.status,
      createdAt: o.createdAt,
      lastUpdatedAt: new Date(),
    }));

    await this.db
      .insert(orders)
      .values(rows)
      .onConflictDoUpdate({
        target: [orders.userId, orders.kalshiOrderId],
        set: {
          remainingCount: sql`excluded.remaining_count`,
          status: sql`excluded.status`,
          lastUpdatedAt: sql`excluded.last_updated_at`,
        },
      });

    // Prune orders not in the response (cancelled / filled).
    const liveIds = new Set(normalised.map((o) => o.kalshiOrderId));
    const existing = await this.db
      .select({ kalshiOrderId: orders.kalshiOrderId, id: orders.id })
      .from(orders)
      .where(eq(orders.userId, userId));
    const toDelete = existing
      .filter((e) => !liveIds.has(e.kalshiOrderId))
      .map((e) => e.id);
    if (toDelete.length > 0) {
      await this.db.delete(orders).where(inArray(orders.id, toDelete));
    }
    return normalised.length;
  }

  /* ------------------------------ Helpers --------------------------------- */

  /** Load every credential currently eligible for polling. */
  private async loadActiveCredentials(): Promise<UserKalshiCredentialRow[]> {
    return this.db
      .select()
      .from(userKalshiCredentials)
      .where(eq(userKalshiCredentials.validationStatus, 'valid'));
  }

  private async findCredential(userId: string): Promise<UserKalshiCredentialRow | undefined> {
    const rows = await this.db
      .select()
      .from(userKalshiCredentials)
      .where(eq(userKalshiCredentials.userId, userId))
      .limit(1);
    return rows[0];
  }

  /**
   * Make sure every ticker we're about to write has a matching `markets` row.
   * The FK on `trades.ticker` is `ON DELETE RESTRICT`, so an insert against a
   * missing ticker would fail. Most tickers are already present (the markets
   * poller covers active markets), so the common case is a no-op.
   *
   * Markets we don't have are fetched one-by-one via the public client. A
   * fetch failure for one ticker logs and continues; the trade for that
   * ticker will then fail its FK check and be dropped — better than aborting
   * the whole batch.
   */
  private async ensureMarkets(tickers: string[]): Promise<void> {
    const unique = [...new Set(tickers)];
    if (unique.length === 0) return;
    const have = await this.db
      .select({ ticker: markets.ticker })
      .from(markets)
      .where(inArray(markets.ticker, unique));
    const present = new Set(have.map((r) => r.ticker));
    const missing = unique.filter((t) => !present.has(t));
    if (missing.length === 0) return;

    const categorise = await loadCategoriser();
    for (const ticker of missing) {
      try {
        const m = await this.publicClient.getMarket(ticker);
        const row = toMarketStub(m, categorise);
        await this.db.insert(markets).values(row).onConflictDoNothing({ target: markets.ticker });
      } catch (err) {
        this.log.warn('could not backfill market for trade', {
          ticker,
          error: errMessage(err),
        });
      }
    }
  }
}

/**
 * Build a minimal `markets` row from a freshly-fetched Kalshi market. Same
 * normalisation the markets poller uses, but we don't need an `event_ticker →
 * category` map here — single market fetches always carry their own
 * `category`, and missing → 'Other' is fine.
 */
function toMarketStub(m: KalshiMarket, categorise: Categoriser): MarketInsert {
  const { category, subcategory } = categorise(m.category ?? null, m.title);
  const mid = yesMidCents(m);
  const prices = marketPrices(m);
  const volumes = marketVolumes(m, mid);
  return {
    ticker: m.ticker,
    title: m.title,
    subtitle: m.subtitle ?? null,
    category,
    subcategory,
    yesSubTitle: m.yes_sub_title ?? null,
    noSubTitle: m.no_sub_title ?? null,
    status: normaliseStatus(m.status),
    resolutionDate: resolutionDate(m),
    yesBid: prices.yesBid,
    yesAsk: prices.yesAsk,
    noBid: prices.noBid,
    noAsk: prices.noAsk,
    volume24hCents: volumes.volume24hCents,
    totalVolumeCents: volumes.totalVolumeCents,
    lastUpdatedAt: new Date(),
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
