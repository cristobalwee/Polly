import type { MarketStatus } from '@polly/shared';
import type { KalshiMarket } from './schemas';

/**
 * Translation between Kalshi's wire vocabulary and polly's normalised forms.
 * Keeping this in one place means the poller, the API and the clients all
 * agree on what "active" means without re-deriving it.
 *
 * Kalshi currently sends prices as decimal-dollar strings (`"0.0100"`) and
 * volumes as fixed-point strings (`"12.00"`); older deployments used integer
 * cents / integer counts. The `*Cents` / `volumeCount` helpers accept either.
 */

/** Map a Kalshi `status` string onto polly's `MarketStatus`. */
export function normaliseStatus(kalshiStatus: string): MarketStatus {
  switch (kalshiStatus.toLowerCase()) {
    case 'open':
    case 'active':
      return 'active';
    case 'closed':
      return 'closed';
    case 'settled':
    case 'finalized':
    case 'determined':
      return 'resolved';
    default:
      // `unopened` and anything we don't recognise yet.
      return 'unopened';
  }
}

/**
 * The best available "this market resolves at" timestamp. Kalshi exposes a
 * few; we prefer the firmest one that is present.
 */
export function resolutionDate(market: KalshiMarket): Date | null {
  const raw = market.expiration_time ?? market.close_time ?? market.expected_expiration_time;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Clamp a cents value into the tradeable 0–100 range, or `null` if absent. */
export function clampCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Resolve a price to integer cents, preferring the decimal-dollar string and
 * falling back to the legacy integer-cent field. `"0.0100"` → `1`.
 */
function priceCents(
  dollars: string | null | undefined,
  legacyCents: number | null | undefined,
): number | null {
  if (dollars !== null && dollars !== undefined && dollars !== '') {
    const n = Number.parseFloat(dollars);
    if (!Number.isNaN(n)) return clampCents(n * 100);
  }
  return clampCents(legacyCents);
}

/** A market's four order-book prices, in integer cents (`null` when unquoted). */
export function marketPrices(market: KalshiMarket): {
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
} {
  return {
    yesBid: priceCents(market.yes_bid_dollars, market.yes_bid),
    yesAsk: priceCents(market.yes_ask_dollars, market.yes_ask),
    noBid: priceCents(market.no_bid_dollars, market.no_bid),
    noAsk: priceCents(market.no_ask_dollars, market.no_ask),
  };
}

/**
 * A volume figure as a contract count, accepting either the fixed-point string
 * or the legacy integer field. Negative / unparseable values become `0`.
 */
function volumeCount(fp: string | null | undefined, legacy: number | null | undefined): number {
  if (fp !== null && fp !== undefined && fp !== '') {
    const n = Number.parseFloat(fp);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (typeof legacy === 'number' && legacy > 0) return legacy;
  return 0;
}

/**
 * Notional dollar volume, in cents.
 *
 * Kalshi reports volume as a *contract count*, not a cash figure. A contract
 * settles somewhere in [0,100]¢, so we approximate cash traded as
 * `contracts × mid-price`. This is an estimate — its only hard requirement is
 * being monotonic in real activity, which is all the "trending" sort needs.
 */
export function notionalVolumeCents(contracts: number, midCents: number): number {
  if (contracts <= 0) return 0;
  return Math.round(contracts * midCents);
}

/** 24h and lifetime notional volume for a market, in cents. */
export function marketVolumes(market: KalshiMarket, midCents: number): {
  volume24hCents: number;
  totalVolumeCents: number;
} {
  return {
    volume24hCents: notionalVolumeCents(volumeCount(market.volume_24h_fp, market.volume_24h), midCents),
    totalVolumeCents: notionalVolumeCents(volumeCount(market.volume_fp, market.volume), midCents),
  };
}

/** Mid-price of the YES side in cents; falls back to last price, then 50. */
export function yesMidCents(market: KalshiMarket): number {
  const { yesBid, yesAsk } = marketPrices(market);
  if (yesBid !== null && yesAsk !== null) return Math.round((yesBid + yesAsk) / 2);
  if (yesBid !== null) return yesBid;
  if (yesAsk !== null) return yesAsk;
  return priceCents(market.last_price_dollars, market.last_price) ?? 50;
}
