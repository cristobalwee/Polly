import type {
  KalshiBalanceResponse,
  KalshiFill,
  KalshiMarketPosition,
  KalshiOrder,
} from './private-schemas';

/**
 * Translation between Kalshi's private-endpoint vocabulary and polly's row
 * shapes. Mirrors the public `normalise.ts` philosophy: accept either the
 * decimal-dollar string or the integer-cent number, prefer the cleaner form,
 * always emit integer cents on the way out.
 */

/** Round/clamp a possibly-string-or-number price to integer cents 0–100. */
export function priceCents(
  cents: number | null | undefined,
  dollars: string | null | undefined,
): number | null {
  if (typeof cents === 'number' && Number.isFinite(cents)) {
    return Math.max(0, Math.min(100, Math.round(cents)));
  }
  if (typeof dollars === 'string' && dollars !== '') {
    const n = Number.parseFloat(dollars);
    if (!Number.isNaN(n)) return Math.max(0, Math.min(100, Math.round(n * 100)));
  }
  return null;
}

/** Same as `priceCents` but uncapped — for balances / exposures, not 0–100. */
export function integerCents(
  cents: number | null | undefined,
  dollars: string | null | undefined,
): number | null {
  if (typeof cents === 'number' && Number.isFinite(cents)) return Math.round(cents);
  if (typeof dollars === 'string' && dollars !== '') {
    const n = Number.parseFloat(dollars);
    if (!Number.isNaN(n)) return Math.round(n * 100);
  }
  return null;
}

/** Cash balance in cents from the `/portfolio/balance` payload. */
export function balanceCents(res: KalshiBalanceResponse): number {
  return integerCents(res.balance, res.balance_dollars) ?? 0;
}

/* -------------------------------------------------------------------------- */
/*  Side normalisation                                                          */
/* -------------------------------------------------------------------------- */

/** Coerce a side-string to `'yes' | 'no'`, or `null` for an unknown value. */
function normSide(value: string | null | undefined): 'yes' | 'no' | null {
  const v = (value ?? '').toLowerCase();
  if (v === 'yes' || v === 'no') return v;
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Positions                                                                   */
/* -------------------------------------------------------------------------- */

/** A position normalised for insertion into `positions`. */
export interface NormalisedPosition {
  ticker: string;
  side: 'yes' | 'no';
  count: number;
  averageCostCents: number;
  marketExposureCents: number;
  realizedPnlCents: number;
}

/**
 * Translate one Kalshi market position into polly's row shape.
 *
 *  - newer payloads carry `market_side` + a positive `position` count,
 *  - older payloads encode the side in the sign of `position` (positive YES,
 *    negative NO).
 *
 * Returns `null` for a flat position (`count === 0`) so the caller can prune
 * the row from `positions` rather than store a zero row.
 */
export function normalisePosition(
  p: KalshiMarketPosition,
): NormalisedPosition | null {
  const rawCount = typeof p.position === 'number' ? p.position : 0;
  const side = normSide(p.market_side) ?? (rawCount >= 0 ? 'yes' : 'no');
  const count = Math.abs(rawCount);
  if (count === 0) return null;

  const averageCostCents = priceCents(p.average_cost, p.average_cost_dollars) ?? 0;
  const marketExposureCents =
    integerCents(p.market_exposure, p.market_exposure_dollars) ?? 0;
  const realizedPnlCents = integerCents(p.realized_pnl, p.realized_pnl_dollars) ?? 0;

  return {
    ticker: p.ticker,
    side,
    count,
    averageCostCents,
    marketExposureCents,
    realizedPnlCents,
  };
}

/* -------------------------------------------------------------------------- */
/*  Fills                                                                       */
/* -------------------------------------------------------------------------- */

/** A fill normalised for insertion into `trades`. */
export interface NormalisedFill {
  kalshiTradeId: string;
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  priceCents: number;
  feeCents: number;
  executedAt: Date;
}

/**
 * Translate one Kalshi fill into polly's `trades` row shape. Returns `null`
 * when the fill is structurally unusable (unknown side, unparsable time, no
 * price): the poller logs and skips rather than failing the batch.
 */
export function normaliseFill(f: KalshiFill): NormalisedFill | null {
  const side = normSide(f.taker_side ?? f.side);
  if (!side) return null;

  const action = f.action?.toLowerCase();
  if (action !== 'buy' && action !== 'sell') return null;

  // Price per contract is the price of the side that was taken — yes_price for
  // a yes fill, no_price for a no fill. Kalshi quotes both on every fill.
  const price =
    side === 'yes'
      ? priceCents(f.yes_price, f.yes_price_dollars)
      : priceCents(f.no_price, f.no_price_dollars);
  if (price === null) return null;

  const executedAt = new Date(f.created_time);
  if (Number.isNaN(executedAt.getTime())) return null;

  const count = Math.max(0, Math.floor(f.count));
  if (count === 0) return null;

  const feeCents = integerCents(f.fee, f.fee_dollars) ?? 0;

  return {
    kalshiTradeId: f.trade_id,
    ticker: f.ticker,
    side,
    action,
    count,
    priceCents: price,
    feeCents,
    executedAt,
  };
}

/* -------------------------------------------------------------------------- */
/*  Orders                                                                      */
/* -------------------------------------------------------------------------- */

/** An order normalised for insertion into `orders`. */
export interface NormalisedOrder {
  kalshiOrderId: string;
  ticker: string;
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  count: number;
  remainingCount: number;
  priceCents: number;
  status: string;
  createdAt: Date;
}

/** Translate one Kalshi order; returns `null` on unusable shape. */
export function normaliseOrder(o: KalshiOrder): NormalisedOrder | null {
  const side = normSide(o.side);
  if (!side) return null;
  const action = o.action?.toLowerCase();
  if (action !== 'buy' && action !== 'sell') return null;

  const price =
    side === 'yes'
      ? priceCents(o.yes_price, o.yes_price_dollars)
      : priceCents(o.no_price, o.no_price_dollars);
  if (price === null) return null;

  const createdAt = new Date(o.created_time);
  if (Number.isNaN(createdAt.getTime())) return null;

  const count = Math.max(0, Math.floor(o.count ?? 0));
  const remainingCount = Math.max(
    0,
    Math.floor(o.remaining_count ?? o.remaining_size ?? count),
  );

  return {
    kalshiOrderId: o.order_id,
    ticker: o.ticker,
    side,
    action,
    count,
    remainingCount,
    priceCents: price,
    status: o.status,
    createdAt,
  };
}
