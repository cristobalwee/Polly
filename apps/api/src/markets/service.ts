import {
  MarketStatusSchema,
  UnifiedCategorySchema,
  type DiscoverResponse,
  type MarketDetail,
  type MarketSearchResponse,
  type MarketSort,
  type MarketStatus,
  type MarketSummary,
  type UnifiedCategory,
} from '@polly/shared';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { marketPriceHistory, markets, type MarketRow } from '../db/schema';

/**
 * Read-side query layer for the markets API: the discover sections, search,
 * and per-market detail. The poller owns writes; this module only reads.
 */

/** How many markets each discover section returns. */
const SECTION_SIZE = 6;
/** Points kept in a card sparkline / detail chart. */
const SPARKLINE_POINTS = 30;
const DETAIL_HISTORY_POINTS = 100;
/** Default search page size. */
const SEARCH_PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */
/*  Row → API projection                                                       */
/* -------------------------------------------------------------------------- */

/** A market row's `category` text is trusted but re-validated to the enum. */
function asCategory(value: string): UnifiedCategory {
  return UnifiedCategorySchema.safeParse(value).data ?? 'Other';
}

function asStatus(value: string): MarketStatus {
  return MarketStatusSchema.safeParse(value).data ?? 'unopened';
}

/** Project a `markets` row plus a sparkline into the client `MarketSummary`. */
function toSummary(row: MarketRow, sparkline: number[]): MarketSummary {
  return {
    ticker: row.ticker,
    title: row.title,
    subtitle: row.subtitle,
    category: asCategory(row.category),
    subcategory: row.subcategory,
    yesSubTitle: row.yesSubTitle,
    noSubTitle: row.noSubTitle,
    status: asStatus(row.status),
    resolutionDate: row.resolutionDate?.toISOString() ?? null,
    yesBid: row.yesBid,
    yesAsk: row.yesAsk,
    noBid: row.noBid,
    noAsk: row.noAsk,
    volume24hCents: row.volume24hCents,
    totalVolumeCents: row.totalVolumeCents,
    sparkline,
    lastUpdatedAt: row.lastUpdatedAt.toISOString(),
  };
}

/**
 * Fetch recent YES-mid prices for a set of tickers, newest-last, capped at
 * `limit` points each. In v0 `market_price_history` is only populated for
 * engaged markets, so this is usually empty — callers must tolerate that.
 */
async function fetchSparklines(
  tickers: string[],
  limit = SPARKLINE_POINTS,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (tickers.length === 0) return result;

  const rows = await db
    .select({
      ticker: marketPriceHistory.ticker,
      ts: marketPriceHistory.timestamp,
      mid: marketPriceHistory.yesMidCents,
    })
    .from(marketPriceHistory)
    .where(inArray(marketPriceHistory.ticker, tickers))
    .orderBy(asc(marketPriceHistory.ticker), asc(marketPriceHistory.timestamp));

  for (const r of rows) {
    const series = result.get(r.ticker) ?? [];
    series.push(r.mid);
    result.set(r.ticker, series);
  }
  // Keep only the most recent `limit` points per ticker.
  for (const [ticker, series] of result) {
    if (series.length > limit) result.set(ticker, series.slice(-limit));
  }
  return result;
}

/** Attach sparklines to a batch of rows in a single history query. */
async function summarise(rows: MarketRow[]): Promise<MarketSummary[]> {
  const sparklines = await fetchSparklines(rows.map((r) => r.ticker));
  return rows.map((r) => toSummary(r, sparklines.get(r.ticker) ?? []));
}

/* -------------------------------------------------------------------------- */
/*  Per-user signal (stubbed until trade tables land)                          */
/* -------------------------------------------------------------------------- */

/**
 * The unified categories a user has traded in.
 *
 * The `trades` table arrives next session; until then this is empty for every
 * user, which makes `trending` degrade to a pure-volume sort and `forYou`
 * return nothing — exactly the v0 behaviour the spec calls for.
 */
async function userTradedCategories(_userId: string): Promise<UnifiedCategory[]> {
  return [];
}

/* -------------------------------------------------------------------------- */
/*  Discover                                                                    */
/* -------------------------------------------------------------------------- */

/** Weight applied to a market in a category the user has traded. */
const CATEGORY_BIAS = 1.5;

/**
 * `GET /markets/discover` — three editorial sections for one user.
 *
 *  - `trending`     — top 24h volume, with categories the user trades weighted
 *                     1.5×; for a user with no history this is a pure volume
 *                     sort.
 *  - `resolvingSoon`— active markets resolving within seven days, soonest first.
 *  - `forYou`       — markets in the user's traded categories (empty in v0).
 */
export async function getDiscover(userId: string): Promise<DiscoverResponse> {
  const traded = new Set(await userTradedCategories(userId));

  /* trending — over-fetch by volume, then re-score with the category bias. */
  const trendingPool = await db
    .select()
    .from(markets)
    .where(eq(markets.status, 'active'))
    .orderBy(desc(markets.volume24hCents))
    .limit(SECTION_SIZE * 8);

  const trendingRows = [...trendingPool]
    .map((row) => ({
      row,
      score: row.volume24hCents * (traded.has(asCategory(row.category)) ? CATEGORY_BIAS : 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, SECTION_SIZE)
    .map((s) => s.row);

  /* resolvingSoon — active, resolving in the next seven days. */
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const resolvingSoonRows = await db
    .select()
    .from(markets)
    .where(
      and(
        eq(markets.status, 'active'),
        gte(markets.resolutionDate, now),
        lte(markets.resolutionDate, in7Days),
      ),
    )
    .orderBy(asc(markets.resolutionDate))
    .limit(SECTION_SIZE);

  /* forYou — categories the user trades; empty until trade tables exist. */
  let forYouRows: MarketRow[] = [];
  if (traded.size > 0) {
    forYouRows = await db
      .select()
      .from(markets)
      .where(
        and(eq(markets.status, 'active'), inArray(markets.category, [...traded])),
      )
      .orderBy(desc(markets.volume24hCents))
      .limit(SECTION_SIZE);
  }

  const [trending, resolvingSoon, forYou] = await Promise.all([
    summarise(trendingRows),
    summarise(resolvingSoonRows),
    summarise(forYouRows),
  ]);
  return { trending, resolvingSoon, forYou };
}

/* -------------------------------------------------------------------------- */
/*  Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface MarketSearchParams {
  q?: string;
  category?: UnifiedCategory;
  /** Accepted and validated, but v0 only has one venue. */
  venue?: string;
  resolvesBefore?: Date;
  resolvesAfter?: Date;
  status?: MarketStatus;
  sort?: MarketSort;
  cursor?: string;
}

/** Opaque cursors are just a base64-encoded row offset for v0. */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}
function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * `GET /markets/search` — filtered, sorted, cursor-paginated market search.
 * Text search is a case-insensitive match on the title.
 */
export async function searchMarkets(
  params: MarketSearchParams,
): Promise<MarketSearchResponse> {
  const filters: SQL[] = [];
  if (params.q && params.q.trim()) {
    // Match the query against title OR category text — so "weather" finds
    // every market whose category is Weather even when the literal word is
    // absent from the title (Kalshi titles read "high temp in LA…").
    const needle = `%${params.q.trim()}%`;
    const q = or(ilike(markets.title, needle), ilike(markets.category, needle));
    if (q) filters.push(q);
  }
  if (params.category) filters.push(eq(markets.category, params.category));
  if (params.status) filters.push(eq(markets.status, params.status));
  if (params.resolvesAfter) filters.push(gte(markets.resolutionDate, params.resolvesAfter));
  if (params.resolvesBefore) filters.push(lte(markets.resolutionDate, params.resolvesBefore));

  const orderBy =
    params.sort === 'resolution'
      ? asc(markets.resolutionDate)
      : params.sort === 'newest'
        ? desc(markets.lastUpdatedAt)
        : desc(markets.volume24hCents);

  const offset = decodeCursor(params.cursor);
  // Fetch one extra row to learn whether another page exists.
  const rows = await db
    .select()
    .from(markets)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(orderBy)
    .limit(SEARCH_PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > SEARCH_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, SEARCH_PAGE_SIZE) : rows;

  return {
    markets: await summarise(page),
    nextCursor: hasMore ? encodeCursor(offset + SEARCH_PAGE_SIZE) : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Detail                                                                      */
/* -------------------------------------------------------------------------- */

/** `GET /markets/:ticker` — one market with its recent price history. */
export async function getMarketDetail(ticker: string): Promise<MarketDetail | null> {
  const [row] = await db.select().from(markets).where(eq(markets.ticker, ticker)).limit(1);
  if (!row) return null;

  const history = await db
    .select({
      ts: marketPriceHistory.timestamp,
      mid: marketPriceHistory.yesMidCents,
      vol: marketPriceHistory.volumeCents,
    })
    .from(marketPriceHistory)
    .where(eq(marketPriceHistory.ticker, ticker))
    .orderBy(desc(marketPriceHistory.timestamp))
    .limit(DETAIL_HISTORY_POINTS);

  // Query is newest-first for the LIMIT; the API contract is oldest-first.
  const priceHistory = history
    .reverse()
    .map((h) => ({
      timestamp: h.ts.toISOString(),
      yesMidCents: h.mid,
      volumeCents: h.vol,
    }));

  const summary = toSummary(row, priceHistory.map((p) => p.yesMidCents));
  return { ...summary, priceHistory };
}
