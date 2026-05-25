/**
 * Realized P&L via FIFO lot matching.
 *
 * Kalshi binary contracts settle at either 0¢ or 100¢, but mark-to-market is
 * unrealised until you sell. The realised P&L of a *closing* trade (a sell
 * that reduces the position on one side) is the difference between the price
 * received and the prices originally paid for the contracts being closed,
 * matched first-in-first-out from the open lots.
 *
 *  realised_for_closing_trade = Σ (sell_price − lot_price) × matched_count
 *
 * We track lots per `(user, ticker, side)` because YES and NO are independent
 * positions on the same market. Opening trades push a new lot onto the queue
 * and store a `null` realisation; closing trades peel matched contracts off
 * the front of the queue and record the summed realisation on the row.
 *
 * The matcher is a *pure function* over an ordered trade history — given the
 * same input it always produces the same output. The poller calls it to
 * recompute `realized_pnl_cents` on every affected `(user, ticker, side)`
 * after a fill ingestion, so the table converges no matter what order Kalshi
 * delivers fills in.
 *
 * **Why a pure replay instead of incremental updates:** a backfill can deliver
 * historical fills *after* later ones have already been ingested, and an
 * incremental scheme would silently miscompute P&L in that window. Replay is
 * O(n) per affected ticker — n is at most a few thousand for any one
 * trader — and is cheap to test in isolation.
 *
 * The exported `matchFifo` works on a flat list; the test cases in
 * `realized-pnl.test.ts` cover multi-buy / partial-sell / full-close /
 * multi-round-trip — these are the math invariants the rest of the journal
 * depends on.
 */

/** A trade row narrowed to the fields the matcher needs. */
export interface FifoTrade {
  /** Caller-supplied identifier so the matcher's output can be re-keyed by id. */
  id: string;
  action: 'buy' | 'sell';
  count: number;
  priceCents: number;
  /** Used only for stable ordering; ties broken by input order. */
  executedAt: Date;
}

/** Outcome of replaying one trade through the lot queue. */
export interface FifoMatchResult {
  /**
   * Per-trade realised P&L (cents) for *closing* trades only. Opening trades
   * are absent from the map — callers should treat absence as `null`.
   */
  realizedByTradeId: Map<string, number>;
  /**
   * Lots remaining open after replay. The position's average cost can be
   * recomputed from these by `weighted average over (count × price)`.
   */
  remainingLots: FifoLot[];
  /**
   * Net realised P&L summed across every closing trade in the input. The
   * position's `realized_pnl_cents` lifetime total uses this.
   */
  totalRealizedCents: number;
}

/** An open lot in the FIFO queue: `count` contracts bought at `priceCents`. */
export interface FifoLot {
  count: number;
  priceCents: number;
}

/**
 * Replay a chronologically-ordered list of trades through FIFO lot matching.
 *
 * Input is expected to be one `(user, ticker, side)` slice — mixing sides
 * yields nonsense because YES and NO are different instruments. The caller
 * partitions before calling.
 *
 * A sell that exceeds the open lot count (theoretically impossible from a
 * sane exchange — Kalshi enforces it server-side) is matched against what
 * lots exist; the over-sold contracts contribute zero cost basis. We log
 * nothing here — the caller decides whether to warn, since the matcher is
 * pure.
 */
export function matchFifo(trades: FifoTrade[]): FifoMatchResult {
  // Stable sort by executed_at — preserves input order for ties so the same
  // input always produces the same lot order.
  const sorted = [...trades].sort(
    (a, b) => a.executedAt.getTime() - b.executedAt.getTime(),
  );

  const lots: FifoLot[] = [];
  const realizedByTradeId = new Map<string, number>();
  let totalRealizedCents = 0;

  for (const t of sorted) {
    if (t.action === 'buy') {
      // Opening trade — push a new lot, no realisation.
      if (t.count > 0) lots.push({ count: t.count, priceCents: t.priceCents });
      continue;
    }

    // action === 'sell' — closing trade. Peel from the front of the queue.
    let remaining = t.count;
    let realized = 0;
    while (remaining > 0 && lots.length > 0) {
      const head = lots[0];
      const matched = Math.min(head.count, remaining);
      realized += (t.priceCents - head.priceCents) * matched;
      head.count -= matched;
      remaining -= matched;
      if (head.count === 0) lots.shift();
    }
    // Any `remaining > 0` here means we ran out of lots — Kalshi shouldn't
    // permit it, but we don't crash. The matched portion contributes; the
    // rest contributes nothing (no cost basis to net against).
    realizedByTradeId.set(t.id, realized);
    totalRealizedCents += realized;
  }

  return { realizedByTradeId, remainingLots: lots, totalRealizedCents };
}

/**
 * Weighted-average cost (cents) of an open-lots queue. `0` when the queue is
 * empty — that's the convention `positions.average_cost_cents` expects when a
 * position is flat (the row itself is deleted by the poller in that case).
 */
export function averageCostCents(lots: FifoLot[]): number {
  let count = 0;
  let cost = 0;
  for (const l of lots) {
    count += l.count;
    cost += l.count * l.priceCents;
  }
  if (count === 0) return 0;
  return Math.round(cost / count);
}

/** Total open contracts across the lot queue — should match the live position. */
export function openCount(lots: FifoLot[]): number {
  let n = 0;
  for (const l of lots) n += l.count;
  return n;
}
