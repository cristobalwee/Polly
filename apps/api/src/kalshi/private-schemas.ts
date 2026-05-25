import { z } from 'zod';

/**
 * Zod schemas for Kalshi's *private* (authenticated) portfolio endpoints.
 *
 * Mirrors the lenient stance of `schemas.ts` for the public client: required
 * fields are the handful the poller actually reads; the rest are `.nullish()`
 * so a quiet shape drift at Kalshi does not block ingestion.
 *
 * Kalshi exposes both decimal-dollar (`"0.45"`) and integer-cent / fixed-point
 * fields on most number-bearing payloads. We accept either form; `normalise.ts`
 * collapses them to integer cents at the boundary.
 */

/* -------------------------------------------------------------------------- */
/*  /portfolio/balance                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Kalshi returns the balance as an integer-cent number in `balance` and the
 * decimal-dollar string in `balance_dollars`. Either is acceptable; the poller
 * prefers the integer-cent form.
 */
export const KalshiBalanceResponseSchema = z.object({
  balance: z.number().nullish(),
  balance_dollars: z.string().nullish(),
});
export type KalshiBalanceResponse = z.infer<typeof KalshiBalanceResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  /portfolio/positions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One position. Kalshi historically returned a signed `position` count where
 * the sign encoded which side (positive = YES, negative = NO). Newer responses
 * carry a `market_side` string. We accept both and normalise downstream.
 */
export const KalshiMarketPositionSchema = z.object({
  ticker: z.string(),
  /** Signed count: positive = long YES, negative = long NO (legacy). */
  position: z.number().nullish(),
  /** Newer shape — explicit `'yes'`/`'no'`. */
  market_side: z.string().nullish(),
  /** Average cost per contract, integer cents in `*_cents`, dollars in `*`. */
  average_cost: z.number().nullish(),
  average_cost_dollars: z.string().nullish(),
  market_exposure: z.number().nullish(),
  market_exposure_dollars: z.string().nullish(),
  realized_pnl: z.number().nullish(),
  realized_pnl_dollars: z.string().nullish(),
  total_traded: z.number().nullish(),
  resting_orders_count: z.number().nullish(),
  fees_paid: z.number().nullish(),
  last_updated_ts: z.string().nullish(),
});
export type KalshiMarketPosition = z.infer<typeof KalshiMarketPositionSchema>;

/** `GET /portfolio/positions`. The `event_positions` field is ignored. */
export const KalshiPositionsResponseSchema = z.object({
  market_positions: z.array(KalshiMarketPositionSchema).nullish(),
  event_positions: z.array(z.unknown()).nullish(),
  cursor: z.string().nullish(),
});
export type KalshiPositionsResponse = z.infer<typeof KalshiPositionsResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  /portfolio/fills                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One executed fill. `taker_side` carries `'yes'`/`'no'`; `side` is sometimes
 * present with the same value. `action` (`'buy'` or `'sell'`) describes the
 * user's side of the trade. Prices in `yes_price` / `no_price` are integer
 * cents; we use whichever matches `taker_side`.
 */
export const KalshiFillSchema = z.object({
  trade_id: z.string(),
  order_id: z.string().nullish(),
  ticker: z.string(),
  /** `'yes'` or `'no'` — which side was taken. */
  side: z.string().nullish(),
  /** Newer field; same vocabulary as `side`. */
  taker_side: z.string().nullish(),
  /** `'buy'` or `'sell'`. */
  action: z.string(),
  count: z.number(),
  /** Cents — Kalshi's `yes_price` / `no_price` are integer cents. */
  yes_price: z.number().nullish(),
  no_price: z.number().nullish(),
  /** Dollar-string equivalents on newer deployments. */
  yes_price_dollars: z.string().nullish(),
  no_price_dollars: z.string().nullish(),
  /** Fee in cents. */
  fee: z.number().nullish(),
  fee_dollars: z.string().nullish(),
  /** ISO-8601 timestamp. */
  created_time: z.string(),
});
export type KalshiFill = z.infer<typeof KalshiFillSchema>;

/** `GET /portfolio/fills`. */
export const KalshiFillsResponseSchema = z.object({
  fills: z.array(KalshiFillSchema).nullish(),
  cursor: z.string().nullish(),
});
export type KalshiFillsResponse = z.infer<typeof KalshiFillsResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  /portfolio/orders                                                           */
/* -------------------------------------------------------------------------- */

/** One resting order on Kalshi. */
export const KalshiOrderSchema = z.object({
  order_id: z.string(),
  ticker: z.string(),
  side: z.string(),
  action: z.string(),
  /** Original size of the order. */
  count: z.number().nullish(),
  /** Resting size — what's still on the book. */
  remaining_count: z.number().nullish(),
  /** Newer field name. */
  remaining_size: z.number().nullish(),
  yes_price: z.number().nullish(),
  no_price: z.number().nullish(),
  yes_price_dollars: z.string().nullish(),
  no_price_dollars: z.string().nullish(),
  /** `resting` | `cancelled` | `executed` | … */
  status: z.string(),
  created_time: z.string(),
  last_update_time: z.string().nullish(),
});
export type KalshiOrder = z.infer<typeof KalshiOrderSchema>;

/** `GET /portfolio/orders`. */
export const KalshiOrdersResponseSchema = z.object({
  orders: z.array(KalshiOrderSchema).nullish(),
  cursor: z.string().nullish(),
});
export type KalshiOrdersResponse = z.infer<typeof KalshiOrdersResponseSchema>;
