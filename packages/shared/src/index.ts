import { z } from 'zod';

/**
 * Contracts shared between the polly API and the polly clients.
 *
 * This package is consumed as raw TypeScript source (no build step): both the
 * Hono backend and the Expo app resolve `@polly/shared` straight to `src/`.
 */

/** Shape of `GET /health` — proves the client/server contract end to end. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  /** ISO-8601 timestamp, e.g. `2026-05-20T18:30:00.000Z`. */
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Kalshi credentials                                                         */
/* -------------------------------------------------------------------------- */

/** Which Kalshi deployment a key belongs to. */
export const KalshiEnvironmentSchema = z.enum(['demo', 'production']);
export type KalshiEnvironment = z.infer<typeof KalshiEnvironmentSchema>;

/**
 * Result of the most recent check against Kalshi's API.
 *  - `unvalidated` — stored but never tested.
 *  - `valid` — last test call authenticated successfully.
 *  - `invalid` — last test call was rejected (bad key / wrong environment).
 */
export const ValidationStatusSchema = z.enum(['unvalidated', 'valid', 'invalid']);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

/**
 * Body of `POST /credentials/kalshi`. The private key is a PEM-encoded RSA key
 * issued by Kalshi alongside the key id; it never leaves the server again.
 */
export const CreateKalshiCredentialSchema = z.object({
  keyId: z.string().min(1, 'Key id is required'),
  privateKey: z
    .string()
    .min(1, 'Private key is required')
    .refine((v) => v.includes('PRIVATE KEY'), {
      message: 'Expected a PEM-encoded private key (-----BEGIN PRIVATE KEY-----)',
    }),
  environment: KalshiEnvironmentSchema,
});
export type CreateKalshiCredential = z.infer<typeof CreateKalshiCredentialSchema>;

/**
 * Everything `GET /credentials/kalshi` is allowed to return — metadata only.
 * The private key and any derived secret are deliberately absent.
 */
export const KalshiCredentialMetadataSchema = z.object({
  keyId: z.string(),
  environment: KalshiEnvironmentSchema,
  validationStatus: ValidationStatusSchema,
  lastValidatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type KalshiCredentialMetadata = z.infer<typeof KalshiCredentialMetadataSchema>;

/** `GET /credentials/kalshi` — `null` when the user has not connected Kalshi. */
export const KalshiCredentialResponseSchema = z.object({
  credential: KalshiCredentialMetadataSchema.nullable(),
});
export type KalshiCredentialResponse = z.infer<typeof KalshiCredentialResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Markets                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * polly's editorial taxonomy. Every market is bucketed into exactly one of
 * these — Kalshi's native categories are mapped onto them by the
 * `market_categories_mapping` table, and anything without a mapping lands in
 * `Other`. The clients use this enum to drive the category filter.
 */
export const UnifiedCategorySchema = z.enum([
  'Weather',
  'Economics',
  'Politics',
  'Sports',
  'Crypto',
  'Culture',
  'Other',
]);
export type UnifiedCategory = z.infer<typeof UnifiedCategorySchema>;

/** Every unified category, in display order — handy for rendering filters. */
export const UNIFIED_CATEGORIES = UnifiedCategorySchema.options;

/**
 * Lifecycle of a market, normalised away from Kalshi's vocabulary:
 *  - `active` — open for trading (Kalshi `open`).
 *  - `closed` — trading halted, not yet settled (Kalshi `closed`).
 *  - `resolved` — settled with a known outcome (Kalshi `settled`).
 *  - `unopened` — scheduled but not yet open (Kalshi `unopened`).
 */
export const MarketStatusSchema = z.enum(['active', 'closed', 'resolved', 'unopened']);
export type MarketStatus = z.infer<typeof MarketStatusSchema>;

/**
 * A single point on a market's price history — one candlestick's worth.
 * `yesMidCents` is the mid of the YES bid/ask in cents (0–100).
 */
export const PricePointSchema = z.object({
  timestamp: z.string().datetime(),
  yesMidCents: z.number().int(),
  volumeCents: z.number().int().nonnegative(),
});
export type PricePoint = z.infer<typeof PricePointSchema>;

/**
 * The card-sized projection of a market — everything the Markets grid and the
 * discover sections need, and nothing they don't. Prices are integer cents.
 */
export const MarketSummarySchema = z.object({
  ticker: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  category: UnifiedCategorySchema,
  subcategory: z.string().nullable(),
  yesSubTitle: z.string().nullable(),
  noSubTitle: z.string().nullable(),
  status: MarketStatusSchema,
  resolutionDate: z.string().datetime().nullable(),
  yesBid: z.number().int().nullable(),
  yesAsk: z.number().int().nullable(),
  noBid: z.number().int().nullable(),
  noAsk: z.number().int().nullable(),
  volume24hCents: z.number().int().nonnegative(),
  totalVolumeCents: z.number().int().nonnegative(),
  /** Recent YES-mid prices, oldest→newest, for a card sparkline. May be empty. */
  sparkline: z.array(z.number().int()),
  lastUpdatedAt: z.string().datetime(),
});
export type MarketSummary = z.infer<typeof MarketSummarySchema>;

/** Full market detail — a summary plus its recent price history. */
export const MarketDetailSchema = MarketSummarySchema.extend({
  priceHistory: z.array(PricePointSchema),
});
export type MarketDetail = z.infer<typeof MarketDetailSchema>;

/**
 * `GET /markets/discover` — three editorial sections, up to six markets each.
 *  - `trending` — highest 24h volume, lightly biased to the user's categories.
 *  - `resolvingSoon` — active markets resolving within seven days.
 *  - `forYou` — markets in categories the user has traded (empty until the
 *    per-user trade tables land next session).
 */
export const DiscoverResponseSchema = z.object({
  trending: z.array(MarketSummarySchema),
  resolvingSoon: z.array(MarketSummarySchema),
  forYou: z.array(MarketSummarySchema),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

/** Sort orders accepted by `GET /markets/search`. */
export const MarketSortSchema = z.enum([
  'volume',
  'resolution',
  'newest',
]);
export type MarketSort = z.infer<typeof MarketSortSchema>;

/** `GET /markets/search` — a page of results plus an opaque next-page cursor. */
export const MarketSearchResponseSchema = z.object({
  markets: z.array(MarketSummarySchema),
  nextCursor: z.string().nullable(),
});
export type MarketSearchResponse = z.infer<typeof MarketSearchResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Trades & Portfolio                                                         */
/* -------------------------------------------------------------------------- */

/** Two-state side of a binary prediction contract. */
export const TradeSideSchema = z.enum(['yes', 'no']);
export type TradeSide = z.infer<typeof TradeSideSchema>;

/** Buy = open / add; Sell = close / reduce. */
export const TradeActionSchema = z.enum(['buy', 'sell']);
export type TradeAction = z.infer<typeof TradeActionSchema>;

/**
 * One executed fill, projected for clients. `realizedPnlCents` is `null` on
 * opening trades and a (possibly negative) integer on closing trades — see
 * the FIFO matcher in `apps/api/src/trades/realized-pnl.ts`.
 */
export const TradeSchema = z.object({
  id: z.string().uuid(),
  ticker: z.string(),
  marketTitle: z.string(),
  category: UnifiedCategorySchema,
  subcategory: z.string().nullable(),
  side: TradeSideSchema,
  action: TradeActionSchema,
  count: z.number().int().nonnegative(),
  priceCents: z.number().int(),
  feeCents: z.number().int(),
  realizedPnlCents: z.number().int().nullable(),
  executedAt: z.string().datetime(),
});
export type Trade = z.infer<typeof TradeSchema>;

/** A user's open position on one side of one market. */
export const PositionSchema = z.object({
  ticker: z.string(),
  marketTitle: z.string(),
  category: UnifiedCategorySchema,
  subcategory: z.string().nullable(),
  side: TradeSideSchema,
  count: z.number().int().nonnegative(),
  averageCostCents: z.number().int(),
  marketExposureCents: z.number().int(),
  realizedPnlCents: z.number().int(),
  /** Recomputed from the latest market mid; may differ from the stored value. */
  unrealizedPnlCents: z.number().int(),
  /** Current market mid (YES side) in cents, for context. `null` if unquoted. */
  currentMidCents: z.number().int().nullable(),
  /** Time the position row was last refreshed by the trades poller. */
  lastUpdatedAt: z.string().datetime(),
});
export type Position = z.infer<typeof PositionSchema>;

/** A resting limit order — read-only for v0. */
export const OrderSchema = z.object({
  id: z.string().uuid(),
  ticker: z.string(),
  marketTitle: z.string(),
  side: TradeSideSchema,
  action: TradeActionSchema,
  count: z.number().int().nonnegative(),
  remainingCount: z.number().int().nonnegative(),
  priceCents: z.number().int(),
  status: z.string(),
  createdAt: z.string().datetime(),
});
export type Order = z.infer<typeof OrderSchema>;

/** Time range for the portfolio-summary equity curve. */
export const PortfolioRangeSchema = z.enum(['1d', '1w', '1m', '3m', 'ytd', 'all']);
export type PortfolioRange = z.infer<typeof PortfolioRangeSchema>;

/** One point on the equity curve. */
export const EquityCurvePointSchema = z.object({
  timestamp: z.string().datetime(),
  equityCents: z.number().int(),
});
export type EquityCurvePoint = z.infer<typeof EquityCurvePointSchema>;

/**
 * `GET /portfolio/summary` — total portfolio value (cash + position MTM),
 * recent change anchors, the cash balance, and the equity curve for the
 * requested time range. Change figures are computed against the closest
 * historical trade-anchored snapshot we have, which is the realised P&L from
 * trades plus the change in cash. They are imperfect (positions taken before
 * the anchor inherit their full unrealised P&L), but they are useful and
 * obvious — the dashboard makes no stronger claim.
 */
export const PortfolioSummarySchema = z.object({
  totalValueCents: z.number().int(),
  cashBalanceCents: z.number().int(),
  positionsValueCents: z.number().int(),
  unrealizedPnlCents: z.number().int(),
  /** Realised P&L across the entire account, lifetime. */
  lifetimeRealizedPnlCents: z.number().int(),
  /** Net change in portfolio value over the requested range. */
  rangeChangeCents: z.number().int(),
  range: PortfolioRangeSchema,
  equityCurve: z.array(EquityCurvePointSchema),
  todayChangeCents: z.number().int(),
  weekChangeCents: z.number().int(),
  monthToDateChangeCents: z.number().int(),
  yearToDateChangeCents: z.number().int(),
});
export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

/** `GET /portfolio/positions` — open positions, current mid baked in. */
export const PositionsResponseSchema = z.object({
  positions: z.array(PositionSchema),
});
export type PositionsResponse = z.infer<typeof PositionsResponseSchema>;

/** `GET /portfolio/orders` — pending limit orders. */
export const OrdersResponseSchema = z.object({
  orders: z.array(OrderSchema),
});
export type OrdersResponse = z.infer<typeof OrdersResponseSchema>;

/** `GET /trades` — paginated trade history. */
export const TradesResponseSchema = z.object({
  trades: z.array(TradeSchema),
  nextCursor: z.string().nullable(),
});
export type TradesResponse = z.infer<typeof TradesResponseSchema>;

/** `GET /trades/:id` — single trade detail. */
export const TradeDetailResponseSchema = z.object({
  trade: TradeSchema,
});
export type TradeDetailResponse = z.infer<typeof TradeDetailResponseSchema>;

/**
 * `POST /trades/sync` — manual-sync response. The sync runs *in the
 * background*; the API returns immediately so the client can show a "syncing"
 * toast. `status` reports the outcome of the run that just kicked off.
 */
export const SyncResponseSchema = z.object({
  status: z.enum(['ok', 'invalid-credentials', 'error']),
  fillsIngested: z.number().int().nonnegative(),
  positionsSynced: z.number().int().nonnegative(),
  ordersSynced: z.number().int().nonnegative(),
  balanceCents: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
