import { z } from 'zod';

/**
 * Zod schemas for Kalshi's public market-data responses.
 *
 * Every response the client receives is parsed through one of these before it
 * is used, so a shape change at Kalshi surfaces as a clear validation error at
 * the boundary rather than an `undefined` deep inside the poller.
 *
 * The schemas are deliberately *lenient* about fields polly does not consume:
 * unknown keys are allowed through, and anything optional in Kalshi's docs is
 * `.nullish()` here. We only hard-require the handful of fields the poller and
 * the API actually read.
 */

/* -------------------------------------------------------------------------- */
/*  Markets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A Kalshi market.
 *
 * Kalshi's current wire format expresses prices as decimal-dollar *strings*
 * (`yes_bid_dollars: "0.0100"`) and volumes as fixed-point strings
 * (`volume_24h_fp: "0.00"`). Older deployments used integer-cent / integer-count
 * fields (`yes_bid`, `volume`). Both are accepted here — `normalise.ts` prefers
 * the dollar form and falls back to the integer form — so the client keeps
 * working across either shape.
 *
 * Almost every field is `.nullish()`: an unopened or thinly-quoted market
 * legitimately omits prices, and we only hard-require `ticker`, `title` and
 * `status`.
 */
export const KalshiMarketSchema = z.object({
  ticker: z.string(),
  event_ticker: z.string().nullish(),
  title: z.string(),
  subtitle: z.string().nullish(),
  yes_sub_title: z.string().nullish(),
  no_sub_title: z.string().nullish(),
  /** e.g. `unopened` | `active` | `open` | `closed` | `settled`. */
  status: z.string(),
  category: z.string().nullish(),
  close_time: z.string().nullish(),
  expiration_time: z.string().nullish(),
  expected_expiration_time: z.string().nullish(),

  // Current shape — decimal-dollar strings.
  yes_bid_dollars: z.string().nullish(),
  yes_ask_dollars: z.string().nullish(),
  no_bid_dollars: z.string().nullish(),
  no_ask_dollars: z.string().nullish(),
  last_price_dollars: z.string().nullish(),
  volume_fp: z.string().nullish(),
  volume_24h_fp: z.string().nullish(),

  // Legacy shape — integer cents / integer counts.
  yes_bid: z.number().nullish(),
  yes_ask: z.number().nullish(),
  no_bid: z.number().nullish(),
  no_ask: z.number().nullish(),
  last_price: z.number().nullish(),
  volume: z.number().nullish(),
  volume_24h: z.number().nullish(),
});
export type KalshiMarket = z.infer<typeof KalshiMarketSchema>;

/** `GET /markets` — a page of markets plus a pagination cursor. */
export const KalshiMarketsResponseSchema = z.object({
  markets: z.array(KalshiMarketSchema),
  cursor: z.string().nullish(),
});

/** `GET /markets/{ticker}` — a single market. */
export const KalshiMarketResponseSchema = z.object({
  market: KalshiMarketSchema,
});

/* -------------------------------------------------------------------------- */
/*  Events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A Kalshi event groups related markets. We read it for its `category`, which
 * Kalshi increasingly hangs off the event rather than each market.
 */
export const KalshiEventSchema = z.object({
  event_ticker: z.string(),
  series_ticker: z.string().nullish(),
  title: z.string().nullish(),
  sub_title: z.string().nullish(),
  category: z.string().nullish(),
});
export type KalshiEvent = z.infer<typeof KalshiEventSchema>;

/** `GET /events` — a page of events plus a pagination cursor. */
export const KalshiEventsResponseSchema = z.object({
  events: z.array(KalshiEventSchema),
  cursor: z.string().nullish(),
});

/* -------------------------------------------------------------------------- */
/*  Orderbook                                                                   */
/* -------------------------------------------------------------------------- */

/** A price level: `[price_cents, contract_count]`. */
const KalshiPriceLevelSchema = z.tuple([z.number(), z.number()]);

/** `GET /markets/{ticker}/orderbook` — resting bids on each side. */
export const KalshiOrderbookResponseSchema = z.object({
  orderbook: z.object({
    yes: z.array(KalshiPriceLevelSchema).nullish(),
    no: z.array(KalshiPriceLevelSchema).nullish(),
  }),
});
export type KalshiOrderbook = z.infer<typeof KalshiOrderbookResponseSchema>['orderbook'];

/* -------------------------------------------------------------------------- */
/*  Candlesticks                                                                */
/* -------------------------------------------------------------------------- */

/** OHLC sub-object Kalshi attaches to prices and bid/ask within a candle. */
const KalshiOhlcSchema = z
  .object({
    open: z.number().nullish(),
    high: z.number().nullish(),
    low: z.number().nullish(),
    close: z.number().nullish(),
    mean: z.number().nullish(),
  })
  .nullish();

/**
 * One candlestick. `end_period_ts` is a Unix epoch in *seconds*. Pricing comes
 * back either as a flat number or as an OHLC object depending on the field;
 * the poller only needs a representative price and the volume.
 */
export const KalshiCandlestickSchema = z.object({
  end_period_ts: z.number(),
  price: KalshiOhlcSchema,
  yes_bid: KalshiOhlcSchema,
  yes_ask: KalshiOhlcSchema,
  volume: z.number().nullish(),
  open_interest: z.number().nullish(),
});
export type KalshiCandlestick = z.infer<typeof KalshiCandlestickSchema>;

/** `GET /markets/{ticker}/candlesticks` — a series of candles. */
export const KalshiCandlesticksResponseSchema = z.object({
  candlesticks: z.array(KalshiCandlestickSchema),
});
