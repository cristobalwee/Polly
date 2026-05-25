/**
 * A token-bucket rate limiter.
 *
 * Kalshi publishes per-second request limits per tier; the public read
 * endpoints we use sit on the conservative end of that range. Rather than
 * firing requests blindly and reacting to 429s, every Kalshi call first
 * `acquire()`s a token here — so we stay under the limit by construction and
 * treat any 429 we *do* see as a genuine surprise worth backing off on.
 *
 * The bucket holds up to `capacity` tokens and refills continuously at
 * `refillPerSec` tokens/second. A burst of `capacity` requests goes through
 * immediately; sustained traffic is paced to the refill rate.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  /** Injectable clock + sleep so tests can drive time deterministically. */
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: {
    capacity: number;
    refillPerSec: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.capacity = opts.capacity;
    this.refillPerSec = opts.refillPerSec;
    this.tokens = opts.capacity;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.lastRefill = this.now();
  }

  /** Add the tokens that have accrued since the last check, capped at capacity. */
  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = t;
  }

  /**
   * Resolve once a token is available, consuming it. If the bucket is empty
   * this waits exactly long enough for the next token to refill, then retries —
   * so concurrent callers are serialised fairly behind the refill rate.
   */
  async acquire(): Promise<void> {
    // Loop rather than recurse: several callers may wake to the same token.
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000);
      await this.sleep(waitMs);
    }
  }
}
