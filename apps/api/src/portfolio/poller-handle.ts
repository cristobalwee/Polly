import type { TradesPoller } from '../trades/poller';

/**
 * Process-wide handle to the active `TradesPoller`.
 *
 * The poller is owned by `src/index.ts`, but the `/trades/sync` route needs to
 * call its `syncUser`. Rather than thread it through every route signature we
 * stash it here at startup and read it from the route. In tests this stays
 * `null`; the route returns a clear "not running" message instead of crashing.
 */
let activePoller: TradesPoller | null = null;

export function setTradesPoller(poller: TradesPoller | null): void {
  activePoller = poller;
}

export function getTradesPoller(): TradesPoller | null {
  return activePoller;
}
