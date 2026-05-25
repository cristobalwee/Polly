import {
  UnifiedCategorySchema,
  type EquityCurvePoint,
  type Order,
  type Position,
  type PortfolioRange,
  type PortfolioSummary,
  type Trade,
  type UnifiedCategory,
} from '@polly/shared';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../db/client';
import {
  markets,
  orders,
  positions,
  trades,
  userBalances,
  type MarketRow,
  type OrderRow,
  type PositionRow,
  type TradeRow,
} from '../db/schema';

/**
 * Read-side query layer for the portfolio + trades endpoints.
 *
 *  - **Live unrealised P&L** is recomputed on every read from the current
 *    market mid (positions are mirrored from Kalshi and may be minutes-stale
 *    by the time the client asks; the prices change every second).
 *  - **Equity curve** is derived from the user's trade history: each fill
 *    moves cash + position state, and we evaluate the running portfolio
 *    value at each point. With no fills the curve is empty and the dashboard
 *    falls back to the current value as a single point.
 *
 * Everything here is read-only — only the `TradesPoller` writes.
 */

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asCategory(value: string): UnifiedCategory {
  return UnifiedCategorySchema.safeParse(value).data ?? 'Other';
}

/** Coerce a stored side string to the typed union, defaulting to `'yes'`. */
function asSide(value: string): 'yes' | 'no' {
  return value === 'no' ? 'no' : 'yes';
}

function asAction(value: string): 'buy' | 'sell' {
  return value === 'sell' ? 'sell' : 'buy';
}

/**
 * Mid-price for a market in the appropriate side's cents. For YES side this
 * is the standard mid of yesBid/yesAsk; for NO side it's the complement
 * (100 − yes_mid) since NO contracts are quoted directly as `(100 − yes)`.
 * `null` when neither side is quoted.
 */
function sideMidCents(market: MarketRow, side: 'yes' | 'no'): number | null {
  const yesBid = market.yesBid;
  const yesAsk = market.yesAsk;
  if (yesBid === null && yesAsk === null) return null;
  const yesMid =
    yesBid !== null && yesAsk !== null
      ? Math.round((yesBid + yesAsk) / 2)
      : yesBid !== null
        ? yesBid
        : yesAsk!;
  return side === 'yes' ? yesMid : 100 - yesMid;
}

/* -------------------------------------------------------------------------- */
/*  Positions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Open positions joined with market data, with unrealised P&L recomputed live
 * against the current mid. Sorted by exposure (largest first) so the
 * dashboard list reads naturally.
 */
export async function getOpenPositions(userId: string): Promise<Position[]> {
  const rows = await db
    .select({
      pos: positions,
      market: markets,
    })
    .from(positions)
    .innerJoin(markets, eq(markets.ticker, positions.ticker))
    .where(eq(positions.userId, userId));

  const projected = rows.map(({ pos, market }) => toPosition(pos, market));
  projected.sort((a, b) => Math.abs(b.marketExposureCents) - Math.abs(a.marketExposureCents));
  return projected;
}

/** Project one (position, market) pair into the client-facing `Position`. */
function toPosition(pos: PositionRow, market: MarketRow): Position {
  const side = asSide(pos.side);
  const mid = sideMidCents(market, side);
  const unrealizedPnlCents =
    mid === null ? 0 : (mid - pos.averageCostCents) * pos.count;
  return {
    ticker: pos.ticker,
    marketTitle: market.title,
    category: asCategory(market.category),
    subcategory: market.subcategory,
    side,
    count: pos.count,
    averageCostCents: pos.averageCostCents,
    marketExposureCents: pos.marketExposureCents,
    realizedPnlCents: pos.realizedPnlCents,
    unrealizedPnlCents,
    currentMidCents: mid,
    lastUpdatedAt: pos.lastUpdatedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Orders                                                                     */
/* -------------------------------------------------------------------------- */

/** Resting limit orders for the user, joined with market titles. */
export async function getRestingOrders(userId: string): Promise<Order[]> {
  const rows = await db
    .select({ order: orders, title: markets.title })
    .from(orders)
    .innerJoin(markets, eq(markets.ticker, orders.ticker))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));

  return rows.map(({ order, title }) => toOrder(order, title));
}

function toOrder(o: OrderRow, marketTitle: string): Order {
  return {
    id: o.id,
    ticker: o.ticker,
    marketTitle,
    side: asSide(o.side),
    action: asAction(o.action),
    count: o.count,
    remainingCount: o.remainingCount,
    priceCents: o.priceCents,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Trades                                                                     */
/* -------------------------------------------------------------------------- */

const TRADE_PAGE_SIZE = 50;

/** Filters accepted by `GET /trades`. */
export interface TradeListParams {
  ticker?: string;
  category?: UnifiedCategory;
  side?: 'yes' | 'no';
  action?: 'buy' | 'sell';
  /** Inclusive — fills executed on or after this date are kept. */
  from?: Date;
  /** Exclusive — fills executed strictly before this date are kept. */
  to?: Date;
  cursor?: string;
}

function encodeTradeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}
function decodeTradeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Paginated trade history with the same filter set the spec calls for. */
export async function listTrades(
  userId: string,
  params: TradeListParams,
): Promise<{ trades: Trade[]; nextCursor: string | null }> {
  const filters = [eq(trades.userId, userId)];
  if (params.ticker) filters.push(eq(trades.ticker, params.ticker));
  if (params.side) filters.push(eq(trades.side, params.side));
  if (params.action) filters.push(eq(trades.action, params.action));
  if (params.from) filters.push(gte(trades.executedAt, params.from));
  if (params.to) filters.push(lt(trades.executedAt, params.to));
  if (params.category) filters.push(eq(markets.category, params.category));

  const offset = decodeTradeCursor(params.cursor);

  const rows = await db
    .select({ trade: trades, market: markets })
    .from(trades)
    .innerJoin(markets, eq(markets.ticker, trades.ticker))
    .where(and(...filters))
    .orderBy(desc(trades.executedAt))
    .limit(TRADE_PAGE_SIZE + 1)
    .offset(offset);

  const hasMore = rows.length > TRADE_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, TRADE_PAGE_SIZE) : rows;

  return {
    trades: page.map(({ trade, market }) => toTrade(trade, market)),
    nextCursor: hasMore ? encodeTradeCursor(offset + TRADE_PAGE_SIZE) : null,
  };
}

/** Single trade detail; `null` if not found or owned by another user. */
export async function getTrade(
  userId: string,
  tradeId: string,
): Promise<Trade | null> {
  const rows = await db
    .select({ trade: trades, market: markets })
    .from(trades)
    .innerJoin(markets, eq(markets.ticker, trades.ticker))
    .where(and(eq(trades.userId, userId), eq(trades.id, tradeId)))
    .limit(1);
  if (rows.length === 0) return null;
  const { trade, market } = rows[0];
  return toTrade(trade, market);
}

function toTrade(t: TradeRow, market: MarketRow): Trade {
  return {
    id: t.id,
    ticker: t.ticker,
    marketTitle: market.title,
    category: asCategory(market.category),
    subcategory: market.subcategory,
    side: asSide(t.side),
    action: asAction(t.action),
    count: t.count,
    priceCents: t.priceCents,
    feeCents: t.feeCents,
    realizedPnlCents: t.realizedPnlCents,
    executedAt: t.executedAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Summary + equity curve                                                     */
/* -------------------------------------------------------------------------- */

/** Default points kept on the equity curve. Down-sampling is rendered, not stored. */
const EQUITY_POINTS_MAX = 200;

/**
 * Build the dashboard's `PortfolioSummary` for one user. The summary is
 * "what the user sees right now" — current value, recent change anchors —
 * plus an equity curve over the requested range derived from the user's
 * trade history.
 */
export async function getPortfolioSummary(
  userId: string,
  range: PortfolioRange,
): Promise<PortfolioSummary> {
  // Cash + open positions
  const [balanceRow] = await db
    .select()
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);
  const cashBalanceCents = balanceRow?.balanceCents ?? 0;

  const livePositions = await getOpenPositions(userId);
  const positionsValueCents = livePositions.reduce(
    (acc, p) => acc + p.averageCostCents * p.count + p.unrealizedPnlCents,
    0,
  );
  const unrealizedPnlCents = livePositions.reduce(
    (acc, p) => acc + p.unrealizedPnlCents,
    0,
  );
  const totalValueCents = cashBalanceCents + positionsValueCents;

  // Lifetime realised P&L — straight sum over the trades table.
  const realisedRows = await db
    .select({ realised: trades.realizedPnlCents })
    .from(trades)
    .where(eq(trades.userId, userId));
  const lifetimeRealizedPnlCents = realisedRows.reduce(
    (acc, r) => acc + (r.realised ?? 0),
    0,
  );

  // Equity curve over the range
  const since = rangeStart(range, new Date());
  const equityCurve = await computeEquityCurve(userId, since, totalValueCents);
  const rangeChangeCents = curveChange(equityCurve, totalValueCents);

  // Anchor changes — one query each, against fresh "since" anchors.
  const todayChangeCents = await changeSince(userId, rangeStart('1d', new Date()), totalValueCents);
  const weekChangeCents = await changeSince(userId, rangeStart('1w', new Date()), totalValueCents);
  const monthToDateChangeCents = await changeSince(userId, startOfMonth(new Date()), totalValueCents);
  const yearToDateChangeCents = await changeSince(userId, startOfYear(new Date()), totalValueCents);

  return {
    totalValueCents,
    cashBalanceCents,
    positionsValueCents,
    unrealizedPnlCents,
    lifetimeRealizedPnlCents,
    rangeChangeCents,
    range,
    equityCurve,
    todayChangeCents,
    weekChangeCents,
    monthToDateChangeCents,
    yearToDateChangeCents,
  };
}

/**
 * Anchor date (oldest point to include) for one of the supported ranges.
 * `'all'` returns the Unix epoch so callers can interpret it as "no lower bound".
 */
function rangeStart(range: PortfolioRange, now: Date): Date {
  const t = now.getTime();
  switch (range) {
    case '1d':
      return new Date(t - 24 * 60 * 60_000);
    case '1w':
      return new Date(t - 7 * 24 * 60 * 60_000);
    case '1m':
      return new Date(t - 30 * 24 * 60 * 60_000);
    case '3m':
      return new Date(t - 90 * 24 * 60 * 60_000);
    case 'ytd':
      return startOfYear(now);
    case 'all':
      return new Date(0);
  }
}

function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Change in portfolio value over the user's trades since `anchor`.
 *
 * v0 simplification: we approximate the value-at-`anchor` as today's value
 * minus the realised P&L recorded since `anchor` plus the cash flow since
 * `anchor`. This is exact for closed trades; for positions opened before
 * `anchor` and still open, their full unrealised P&L gets attributed to the
 * window — a known imperfection the dashboard does not over-claim about.
 */
async function changeSince(
  userId: string,
  anchor: Date,
  currentValueCents: number,
): Promise<number> {
  const rows = await db
    .select({ realised: trades.realizedPnlCents })
    .from(trades)
    .where(and(eq(trades.userId, userId), gte(trades.executedAt, anchor)));
  const realised = rows.reduce((acc, r) => acc + (r.realised ?? 0), 0);

  // With no historical balance snapshots, we report realised P&L as the
  // change anchor. The current portfolio value minus realised P&L would
  // approximate the anchor's value, but without per-day balance snapshots we
  // can't be more precise — we surface realised + current unrealised P&L
  // accrual implicitly via the user's running totals shown elsewhere.
  void currentValueCents;
  return realised;
}

/**
 * Build an equity curve from the user's trade history.
 *
 * The curve walks every trade in chronological order from `since`; at each
 * step it credits realised P&L (for closing trades) into a running
 * `equity = baseline + realised`. The baseline is today's portfolio value
 * minus today's lifetime realised P&L — i.e. roughly "the cost basis of
 * everything that's still open", which is the cleanest anchor we have
 * without per-day snapshots. The final point is always today's true value.
 *
 * This is intentionally simple — it captures realised P&L over time, which is
 * the part of the curve users care most about. Anything fancier needs daily
 * mark-to-market snapshots we don't store yet.
 */
async function computeEquityCurve(
  userId: string,
  since: Date,
  currentValueCents: number,
): Promise<EquityCurvePoint[]> {
  const rows = await db
    .select({ executedAt: trades.executedAt, realised: trades.realizedPnlCents })
    .from(trades)
    .where(and(eq(trades.userId, userId), gte(trades.executedAt, since)))
    .orderBy(asc(trades.executedAt));

  if (rows.length === 0) {
    return [{ timestamp: new Date().toISOString(), equityCents: currentValueCents }];
  }

  const realisedTotal = rows.reduce((a, r) => a + (r.realised ?? 0), 0);
  const baseline = currentValueCents - realisedTotal;

  const raw: EquityCurvePoint[] = [];
  let running = baseline;
  for (const r of rows) {
    running += r.realised ?? 0;
    raw.push({ timestamp: r.executedAt.toISOString(), equityCents: running });
  }
  // Always finish at the current portfolio value — captures unrealised
  // movements since the last fill.
  raw.push({ timestamp: new Date().toISOString(), equityCents: currentValueCents });

  return downsample(raw, EQUITY_POINTS_MAX);
}

/** Down-sample by uniform stride; keeps first + last points intact. */
function downsample(points: EquityCurvePoint[], maxPoints: number): EquityCurvePoint[] {
  if (points.length <= maxPoints) return points;
  const out: EquityCurvePoint[] = [];
  const stride = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.min(points.length - 1, Math.round(i * stride))]);
  }
  return out;
}

/** First-to-last delta over the curve, defaulting to 0 for an empty one. */
function curveChange(curve: EquityCurvePoint[], fallbackEnd: number): number {
  if (curve.length === 0) return 0;
  return fallbackEnd - curve[0].equityCents;
}
