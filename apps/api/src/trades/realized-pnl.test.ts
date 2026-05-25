import { describe, expect, it } from 'vitest';
import { averageCostCents, matchFifo, openCount, type FifoTrade } from './realized-pnl';

/**
 * Unit tests for the FIFO realised-P&L matcher.
 *
 * Realised P&L is the most load-bearing number downstream: every analytics
 * dashboard, every change anchor, every "did you make money this week" stat
 * descends from it. The tests below pin down the math on the four scenarios
 * the spec calls out: multiple buys at different prices, partial sells, full
 * position close, and multiple round-trips. We also cover stable ordering
 * (input order is the tie-breaker for the same `executed_at`) and the
 * `null`-vs-number contract for opening/closing trades.
 *
 * The matcher is pure — no I/O, no clock — so the assertions are exact.
 */

/** Test-only helper: build a trade with a deterministic time offset. */
function trade(
  id: string,
  action: 'buy' | 'sell',
  count: number,
  priceCents: number,
  offsetMs = 0,
): FifoTrade {
  return {
    id,
    action,
    count,
    priceCents,
    executedAt: new Date(2026, 0, 1, 0, 0, 0, offsetMs),
  };
}

describe('matchFifo — opening trades', () => {
  it('records no realised P&L for pure buys; lots accumulate', () => {
    const r = matchFifo([
      trade('t1', 'buy', 10, 30, 0),
      trade('t2', 'buy', 20, 40, 1),
    ]);
    // Neither buy is a closing trade — neither gets a realised entry.
    expect(r.realizedByTradeId.size).toBe(0);
    expect(r.totalRealizedCents).toBe(0);
    expect(r.remainingLots).toEqual([
      { count: 10, priceCents: 30 },
      { count: 20, priceCents: 40 },
    ]);
    expect(openCount(r.remainingLots)).toBe(30);
    // Weighted average: (10*30 + 20*40) / 30 = 1100/30 = 36.67 → 37
    expect(averageCostCents(r.remainingLots)).toBe(37);
  });
});

describe('matchFifo — partial sell with multi-price buys', () => {
  it('matches the oldest lot first and reports its specific cost basis', () => {
    // Bought 10 @ 30¢, then 10 @ 50¢, then sold 8 @ 60¢.
    // FIFO: 8 contracts come off the 30¢ lot. Realised = (60−30) × 8 = 240.
    const r = matchFifo([
      trade('b1', 'buy', 10, 30, 0),
      trade('b2', 'buy', 10, 50, 1),
      trade('s1', 'sell', 8, 60, 2),
    ]);
    expect(r.realizedByTradeId.get('s1')).toBe(240);
    expect(r.realizedByTradeId.has('b1')).toBe(false);
    expect(r.realizedByTradeId.has('b2')).toBe(false);
    expect(r.totalRealizedCents).toBe(240);
    // Remaining: 2 @ 30¢ + 10 @ 50¢ = 12 contracts
    expect(r.remainingLots).toEqual([
      { count: 2, priceCents: 30 },
      { count: 10, priceCents: 50 },
    ]);
    expect(openCount(r.remainingLots)).toBe(12);
  });

  it('spans the sell across two lots when one is too small', () => {
    // Sell 15 against [10 @ 30, 10 @ 50] at 60¢.
    // 10 off the 30¢ lot → (60−30) × 10 = 300.
    // 5 off the 50¢ lot → (60−50) × 5 = 50.
    // Total realised 350.
    const r = matchFifo([
      trade('b1', 'buy', 10, 30, 0),
      trade('b2', 'buy', 10, 50, 1),
      trade('s1', 'sell', 15, 60, 2),
    ]);
    expect(r.realizedByTradeId.get('s1')).toBe(350);
    expect(r.remainingLots).toEqual([{ count: 5, priceCents: 50 }]);
  });
});

describe('matchFifo — full position close', () => {
  it('flattens the lot queue and totals realised P&L across both lots', () => {
    const r = matchFifo([
      trade('b1', 'buy', 5, 40, 0),
      trade('b2', 'buy', 5, 60, 1),
      trade('s1', 'sell', 10, 70, 2),
    ]);
    // (70−40)×5 + (70−60)×5 = 150 + 50 = 200
    expect(r.realizedByTradeId.get('s1')).toBe(200);
    expect(r.remainingLots).toEqual([]);
    expect(openCount(r.remainingLots)).toBe(0);
  });
});

describe('matchFifo — multi-round-trip', () => {
  it('keeps a clean lot queue across alternating opens and closes', () => {
    // Round trip 1: open 10 @ 20, close 10 @ 25 → realised +50.
    // Round trip 2: open 5 @ 40, close 5 @ 35  → realised −25.
    const r = matchFifo([
      trade('a', 'buy', 10, 20, 0),
      trade('b', 'sell', 10, 25, 1),
      trade('c', 'buy', 5, 40, 2),
      trade('d', 'sell', 5, 35, 3),
    ]);
    expect(r.realizedByTradeId.get('b')).toBe(50);
    expect(r.realizedByTradeId.get('d')).toBe(-25);
    expect(r.totalRealizedCents).toBe(25);
    expect(r.remainingLots).toEqual([]);
  });

  it('partial close, scale up, partial close — lot order preserved', () => {
    // Buy 10 @ 30, sell 4 @ 50 → realised (50−30)×4 = 80. Lots: 6 @ 30.
    // Buy 10 @ 40 (added behind the 30¢ lot). Lots: [6@30, 10@40].
    // Sell 8 @ 45: 6 @ 30 → (45−30)×6 = 90, 2 @ 40 → (45−40)×2 = 10. Realised 100.
    const r = matchFifo([
      trade('a', 'buy', 10, 30, 0),
      trade('b', 'sell', 4, 50, 1),
      trade('c', 'buy', 10, 40, 2),
      trade('d', 'sell', 8, 45, 3),
    ]);
    expect(r.realizedByTradeId.get('b')).toBe(80);
    expect(r.realizedByTradeId.get('d')).toBe(100);
    expect(r.totalRealizedCents).toBe(180);
    expect(r.remainingLots).toEqual([{ count: 8, priceCents: 40 }]);
  });
});

describe('matchFifo — ordering & determinism', () => {
  it('is stable across input shuffling because it sorts by executedAt', () => {
    const original = [
      trade('a', 'buy', 10, 30, 0),
      trade('b', 'sell', 10, 50, 10),
    ];
    const reordered = [original[1], original[0]];
    const r1 = matchFifo(original);
    const r2 = matchFifo(reordered);
    expect(r2.realizedByTradeId.get('b')).toBe(r1.realizedByTradeId.get('b'));
    expect(r2.totalRealizedCents).toBe(r1.totalRealizedCents);
  });

  it('does not crash on a sell with no open lots — over-sold contributes 0', () => {
    // Selling without buying is impossible on Kalshi, but a malformed
    // backfill shouldn't crash us.
    const r = matchFifo([trade('s', 'sell', 5, 50)]);
    expect(r.realizedByTradeId.get('s')).toBe(0);
    expect(r.remainingLots).toEqual([]);
  });
});

describe('averageCostCents', () => {
  it('returns 0 for an empty lot queue', () => {
    expect(averageCostCents([])).toBe(0);
  });
  it('weights the average by lot count', () => {
    // 3 @ 20 + 2 @ 70 → (60 + 140) / 5 = 40
    expect(averageCostCents([{ count: 3, priceCents: 20 }, { count: 2, priceCents: 70 }])).toBe(40);
  });
});
