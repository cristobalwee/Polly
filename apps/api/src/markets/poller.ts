import { sql } from 'drizzle-orm';
import { db as defaultDb, type Database } from '../db/client';
import {
  marketPriceHistory,
  markets,
  type MarketInsert,
  type MarketPriceHistoryInsert,
} from '../db/schema';
import { KalshiPublicClient } from '../kalshi/public-client';
import type { KalshiCandlestick, KalshiEvent, KalshiMarket } from '../kalshi/schemas';
import {
  clampCents,
  marketPrices,
  marketVolumes,
  normaliseStatus,
  notionalVolumeCents,
  resolutionDate,
  yesMidCents,
} from '../kalshi/normalise';
import { loadCategoriser, seedCategoryMappings, type Categoriser } from './categorization';

/**
 * Background worker that keeps the `markets` table — and, for engaged markets,
 * `market_price_history` — in sync with Kalshi.
 *
 * Three cadences:
 *  - **every 5 min** — upsert every active market (prices, volumes, status).
 *  - **every 30 min** — refresh recently closed/resolved markets so their
 *    status reflects settlement.
 *  - **every 15 min** — for markets some user is engaged with, pull
 *    candlesticks into `market_price_history`.
 *
 * Idempotency & resumability: every write is an upsert keyed on a natural key
 * (`ticker`, or `(ticker, timestamp)`), so a run that dies half-way leaves no
 * partial garbage and the next run simply re-upserts. A per-cadence in-flight
 * guard means a slow run is skipped rather than overlapped — combined with the
 * idempotent upserts, two concurrent polls cannot corrupt the table.
 *
 * For v0 it runs as `setInterval` loops inside the API process; the class is
 * deliberately self-contained so it can later be lifted into its own worker.
 */

/** A minimal logger — the API passes `console`; tests pass a spy. */
export interface PollerLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Default logger: structured-ish lines on the console. */
export const consoleLogger: PollerLogger = {
  info: (m, meta) => console.log(`[poller] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[poller] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[poller] ${m}`, meta ?? ''),
};

export interface MarketsPollerOptions {
  client: KalshiPublicClient;
  database?: Database;
  logger?: PollerLogger;
  /** Override poll cadences (ms) — tests use this to avoid real timers. */
  intervals?: {
    activeMs?: number;
    closedMs?: number;
    candlesticksMs?: number;
  };
}

const FIVE_MIN = 5 * 60_000;
const FIFTEEN_MIN = 15 * 60_000;
const THIRTY_MIN = 30 * 60_000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;

export class MarketsPoller {
  private readonly client: KalshiPublicClient;
  private readonly db: Database;
  private readonly log: PollerLogger;
  private readonly intervals: { activeMs: number; closedMs: number; candlesticksMs: number };

  private timers: NodeJS.Timeout[] = [];
  /** In-flight guard per cadence — prevents a slow poll overlapping itself. */
  private running = { active: false, closed: false, candlesticks: false };

  constructor(opts: MarketsPollerOptions) {
    this.client = opts.client;
    this.db = opts.database ?? defaultDb;
    this.log = opts.logger ?? consoleLogger;
    this.intervals = {
      activeMs: opts.intervals?.activeMs ?? FIVE_MIN,
      closedMs: opts.intervals?.closedMs ?? THIRTY_MIN,
      candlesticksMs: opts.intervals?.candlesticksMs ?? FIFTEEN_MIN,
    };
  }

  /**
   * Seed the category mapping, run one of each poll immediately, then schedule
   * the recurring loops. Returns once the initial active-markets poll is done
   * so callers know the table has data.
   */
  async start(): Promise<void> {
    const seeded = await seedCategoryMappings();
    if (seeded > 0) this.log.info(`seeded ${seeded} category mappings`);

    // Kick the first active poll synchronously so the API has data to serve;
    // the slower polls can warm up in the background.
    await this.pollActiveMarkets();
    void this.pollClosedMarkets();
    void this.pollCandlesticks();

    this.timers.push(
      setInterval(() => void this.pollActiveMarkets(), this.intervals.activeMs),
      setInterval(() => void this.pollClosedMarkets(), this.intervals.closedMs),
      setInterval(() => void this.pollCandlesticks(), this.intervals.candlesticksMs),
    );
    this.log.info('poller started', this.intervals);
  }

  /** Stop every recurring loop. Safe to call more than once. */
  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /* ----------------------------- Active poll ------------------------------ */

  /**
   * Fetch every active market from Kalshi and upsert it. Never throws: a
   * Kalshi or validation failure is logged and the run ends cleanly so the
   * interval keeps ticking.
   */
  async pollActiveMarkets(): Promise<void> {
    if (this.running.active) {
      this.log.warn('active poll skipped — previous run still in flight');
      return;
    }
    this.running.active = true;
    const startedAt = Date.now();
    try {
      const categorise = await loadCategoriser();
      const categoryByEvent = await this.fetchEventCategories();
      const kalshiMarkets = await this.client.getAllMarkets({ status: 'open' });

      const upserted = await this.upsertMarkets(kalshiMarkets, categoryByEvent, categorise);
      this.log.info('active poll ok', {
        fetched: kalshiMarkets.length,
        upserted,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      this.log.error('active poll failed', { error: errMessage(err) });
    } finally {
      this.running.active = false;
    }
  }

  /* ----------------------------- Closed poll ------------------------------ */

  /**
   * Refresh markets that settled in the last seven days so their stored status
   * catches up with Kalshi. Closed markets are upserted just like active ones.
   */
  async pollClosedMarkets(): Promise<void> {
    if (this.running.closed) {
      this.log.warn('closed poll skipped — previous run still in flight');
      return;
    }
    this.running.closed = true;
    const startedAt = Date.now();
    try {
      const categorise = await loadCategoriser();
      const categoryByEvent = await this.fetchEventCategories();
      const cutoff = Date.now() - SEVEN_DAYS_MS;

      // Kalshi treats `closed` and `settled` as separate statuses.
      const recent: KalshiMarket[] = [];
      for (const status of ['closed', 'settled']) {
        const page = await this.client.getAllMarkets({ status, maxPages: 10 });
        for (const m of page) {
          const resolved = resolutionDate(m);
          if (resolved && resolved.getTime() >= cutoff) recent.push(m);
        }
      }

      const upserted = await this.upsertMarkets(recent, categoryByEvent, categorise);
      this.log.info('closed poll ok', { fetched: recent.length, upserted, ms: Date.now() - startedAt });
    } catch (err) {
      this.log.error('closed poll failed', { error: errMessage(err) });
    } finally {
      this.running.closed = false;
    }
  }

  /* -------------------------- Candlesticks poll --------------------------- */

  /**
   * For every engaged market (in some user's watchlist / positions / recently
   * viewed), pull recent candlesticks into `market_price_history`.
   *
   * In v0 no per-user tables exist yet, so `engagedTickers()` returns nothing
   * and this is a cheap no-op — but the machinery is here so the cadence is
   * real the moment those tables land.
   */
  async pollCandlesticks(): Promise<void> {
    if (this.running.candlesticks) {
      this.log.warn('candlesticks poll skipped — previous run still in flight');
      return;
    }
    this.running.candlesticks = true;
    const startedAt = Date.now();
    try {
      const tickers = await this.engagedTickers();
      if (tickers.length === 0) {
        this.log.info('candlesticks poll ok', { engaged: 0, ms: Date.now() - startedAt });
        return;
      }

      let points = 0;
      for (const ticker of tickers) {
        try {
          const candles = await this.client.getCandlesticks(ticker, {
            startTs: Math.floor((Date.now() - SEVEN_DAYS_MS) / 1000),
            endTs: Math.floor(Date.now() / 1000),
            periodInterval: 60,
          });
          points += await this.upsertPriceHistory(ticker, candles);
        } catch (err) {
          // One bad market must not abort the rest — log and move on.
          this.log.warn('candlesticks skipped for market', {
            ticker,
            error: errMessage(err),
          });
        }
      }
      this.log.info('candlesticks poll ok', {
        engaged: tickers.length,
        points,
        ms: Date.now() - startedAt,
      });
    } catch (err) {
      this.log.error('candlesticks poll failed', { error: errMessage(err) });
    } finally {
      this.running.candlesticks = false;
    }
  }

  /* ------------------------------ Internals ------------------------------- */

  /**
   * Tickers of markets some user is engaged with. v0 has no watchlist /
   * positions / recently-viewed tables, so this is empty by construction; it
   * becomes a real query once those tables exist (next session).
   */
  private async engagedTickers(): Promise<string[]> {
    return [];
  }

  /** Build an `event_ticker → category` map from Kalshi's events endpoint. */
  private async fetchEventCategories(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let cursor: string | undefined;
    // The demo carries ~10k events; 100 pages of 200 covers them with room to
    // spare. Each page is rate-limited, so this costs ~10s of an otherwise
    // idle 5-minute window.
    for (let page = 0; page < 100; page++) {
      let events: KalshiEvent[];
      let next: string | null;
      try {
        ({ events, cursor: next } = await this.client.getEvents({ limit: 200, cursor }));
      } catch (err) {
        // Categories degrade gracefully — markets still upsert as `Other`.
        this.log.warn('event categories fetch failed', { error: errMessage(err) });
        break;
      }
      for (const e of events) {
        if (e.category) map.set(e.event_ticker, e.category);
      }
      if (!next || events.length === 0) break;
      cursor = next;
    }
    return map;
  }

  /**
   * Turn Kalshi markets into table rows and upsert them in one statement.
   * Each market is transformed inside its own try/catch, so a single malformed
   * market is logged and skipped rather than failing the whole batch.
   */
  private async upsertMarkets(
    kalshiMarkets: KalshiMarket[],
    categoryByEvent: Map<string, string>,
    categorise: Categoriser,
  ): Promise<number> {
    // Transform, skipping malformed markets, and de-dupe by ticker: Kalshi can
    // return the same market twice across pages, and an `ON CONFLICT` insert
    // cannot touch the same row twice in one statement.
    const byTicker = new Map<string, MarketInsert>();
    for (const m of kalshiMarkets) {
      try {
        const row = this.toMarketRow(m, categoryByEvent, categorise);
        byTicker.set(row.ticker, row);
      } catch (err) {
        this.log.warn('skipped malformed market', {
          ticker: m?.ticker,
          error: errMessage(err),
        });
      }
    }
    const rows = [...byTicker.values()];
    if (rows.length === 0) return 0;

    // Upsert in batches: one statement binds 16 params/row, so we stay well
    // under Postgres's 65535-parameter ceiling. `excluded.*` is the row we
    // tried to insert, so a re-run with fresh prices overwrites idempotently.
    for (const batch of chunk(rows, UPSERT_BATCH)) {
      await this.db
        .insert(markets)
        .values(batch)
        .onConflictDoUpdate({
          target: markets.ticker,
          set: {
            title: sql`excluded.title`,
            subtitle: sql`excluded.subtitle`,
            category: sql`excluded.category`,
            subcategory: sql`excluded.subcategory`,
            yesSubTitle: sql`excluded.yes_sub_title`,
            noSubTitle: sql`excluded.no_sub_title`,
            status: sql`excluded.status`,
            resolutionDate: sql`excluded.resolution_date`,
            yesBid: sql`excluded.yes_bid`,
            yesAsk: sql`excluded.yes_ask`,
            noBid: sql`excluded.no_bid`,
            noAsk: sql`excluded.no_ask`,
            volume24hCents: sql`excluded.volume_24h_cents`,
            totalVolumeCents: sql`excluded.total_volume_cents`,
            lastUpdatedAt: sql`excluded.last_updated_at`,
          },
        });
    }
    return rows.length;
  }

  /** Project one Kalshi market onto a `markets` row. Throws if `ticker` is absent. */
  private toMarketRow(
    m: KalshiMarket,
    categoryByEvent: Map<string, string>,
    categorise: Categoriser,
  ): MarketInsert {
    if (!m.ticker || typeof m.ticker !== 'string') {
      throw new Error('market has no ticker');
    }
    const kalshiCategory = m.category ?? (m.event_ticker ? categoryByEvent.get(m.event_ticker) : null);
    const { category, subcategory } = categorise(kalshiCategory, m.title);
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

  /**
   * Upsert candlesticks for one market into `market_price_history`. The unique
   * `(ticker, timestamp)` index makes this idempotent — re-polling the same
   * window updates points in place rather than duplicating them.
   */
  private async upsertPriceHistory(
    ticker: string,
    candles: KalshiCandlestick[],
  ): Promise<number> {
    // De-dupe by timestamp for the same reason markets de-dupe by ticker.
    const byTs = new Map<number, MarketPriceHistoryInsert>();
    for (const c of candles) {
      if (!Number.isFinite(c.end_period_ts)) continue;
      const mid =
        clampCents(c.price?.mean) ??
        clampCents(c.price?.close) ??
        midOf(clampCents(c.yes_bid?.close), clampCents(c.yes_ask?.close));
      if (mid === null) continue;
      byTs.set(c.end_period_ts, {
        ticker,
        timestamp: new Date(c.end_period_ts * 1000),
        yesMidCents: mid,
        volumeCents: notionalVolumeCents(c.volume ?? 0, mid),
      });
    }
    const rows = [...byTs.values()];
    if (rows.length === 0) return 0;

    for (const batch of chunk(rows, UPSERT_BATCH)) {
      await this.db
        .insert(marketPriceHistory)
        .values(batch)
        .onConflictDoUpdate({
          target: [marketPriceHistory.ticker, marketPriceHistory.timestamp],
          set: {
            yesMidCents: sql`excluded.yes_mid_cents`,
            volumeCents: sql`excluded.volume_cents`,
          },
        });
    }
    return rows.length;
  }
}

/** Rows per upsert statement — 16 params/row keeps us under Postgres's limit. */
const UPSERT_BATCH = 500;

/** Split an array into fixed-size chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Mid of two optional cents values, or `null` if neither is present. */
function midOf(a: number | null, b: number | null): number | null {
  if (a !== null && b !== null) return Math.round((a + b) / 2);
  return a ?? b;
}

/** Safe error-to-string for log lines. */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
