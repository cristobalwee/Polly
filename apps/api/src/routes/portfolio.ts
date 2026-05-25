import {
  PortfolioRangeSchema,
  type OrdersResponse,
  type PortfolioSummary,
  type PositionsResponse,
} from '@polly/shared';
import { Hono } from 'hono';
import {
  getOpenPositions,
  getPortfolioSummary,
  getRestingOrders,
} from '../portfolio/service';
import { requireAuth, type AuthVariables } from '../middleware/auth';

/**
 * Portfolio endpoints — what the dashboard reads.
 *
 * All routes require a session and only ever return the calling user's data.
 * The poller is the only writer; these routes are pure reads.
 */
export const portfolioRoute = new Hono<{ Variables: AuthVariables }>();

portfolioRoute.use('*', requireAuth);

/**
 * GET /portfolio/summary — total value, cash, recent change anchors, and the
 * equity curve over the requested time range (`?range=1d|1w|1m|3m|ytd|all`).
 * An unknown range falls back to `1m` rather than 400'ing, so a stale client
 * never gets a hard error.
 */
portfolioRoute.get('/summary', async (c) => {
  const { id: userId } = c.get('user');
  const range = PortfolioRangeSchema.safeParse(c.req.query('range')).data ?? '1m';
  const summary: PortfolioSummary = await getPortfolioSummary(userId, range);
  return c.json(summary);
});

/** GET /portfolio/positions — open positions with live unrealized P&L. */
portfolioRoute.get('/positions', async (c) => {
  const { id: userId } = c.get('user');
  const body: PositionsResponse = { positions: await getOpenPositions(userId) };
  return c.json(body);
});

/** GET /portfolio/orders — pending limit orders. */
portfolioRoute.get('/orders', async (c) => {
  const { id: userId } = c.get('user');
  const body: OrdersResponse = { orders: await getRestingOrders(userId) };
  return c.json(body);
});
