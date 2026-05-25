import {
  MarketSortSchema,
  MarketStatusSchema,
  UnifiedCategorySchema,
} from '@polly/shared';
import { Hono } from 'hono';
import { getDiscover, getMarketDetail, searchMarkets } from '../markets/service';
import { requireAuth, type AuthVariables } from '../middleware/auth';

/**
 * Public market-data endpoints.
 *
 * The data itself is shared across all users, but the routes still require a
 * session: the app is gated behind auth, and `discover` is personalised by
 * `userId`. All three routes are read-only — the `MarketsPoller` owns writes.
 */
export const marketsRoute = new Hono<{ Variables: AuthVariables }>();

marketsRoute.use('*', requireAuth);

/** Parse an optional ISO date query param; ignore an unparseable value. */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * GET /markets/discover — trending / resolvingSoon / forYou sections for the
 * calling user.
 */
marketsRoute.get('/discover', async (c) => {
  const { id: userId } = c.get('user');
  return c.json(await getDiscover(userId));
});

/**
 * GET /markets/search — text + filter search with cursor pagination.
 * Query: `q`, `category`, `venue`, `status`, `sort`, `resolvesBefore`,
 * `resolvesAfter`, `cursor`. Unknown/invalid filter values are dropped rather
 * than rejected, so a stale client never gets a hard 400.
 */
marketsRoute.get('/search', async (c) => {
  const q = c.req.query();
  const result = await searchMarkets({
    q: q.q,
    category: UnifiedCategorySchema.safeParse(q.category).data,
    venue: q.venue ?? 'kalshi',
    status: MarketStatusSchema.safeParse(q.status).data,
    sort: MarketSortSchema.safeParse(q.sort).data,
    resolvesBefore: parseDate(q.resolvesBefore),
    resolvesAfter: parseDate(q.resolvesAfter),
    cursor: q.cursor,
  });
  return c.json(result);
});

/** GET /markets/:ticker — full detail for one market, or 404. */
marketsRoute.get('/:ticker', async (c) => {
  const detail = await getMarketDetail(c.req.param('ticker'));
  if (!detail) {
    return c.json({ error: 'Market not found' }, 404);
  }
  return c.json(detail);
});
