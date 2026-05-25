import {
  TradeActionSchema,
  TradeSideSchema,
  UnifiedCategorySchema,
  type SyncResponse,
  type TradeDetailResponse,
  type TradesResponse,
} from '@polly/shared';
import { Hono } from 'hono';
import { getTradesPoller } from '../portfolio/poller-handle';
import { getTrade, listTrades } from '../portfolio/service';
import { requireAuth, type AuthVariables } from '../middleware/auth';

/**
 * Trade-history endpoints + the manual sync trigger.
 *
 *  - `GET /trades` — paginated history with `ticker` / `category` / `side` /
 *    `action` / `from` / `to` / `cursor` filters. Unknown filter values are
 *    silently dropped (matches `/markets/search` behaviour).
 *  - `GET /trades/:id` — single trade detail or 404.
 *  - `POST /trades/sync` — fire-and-mostly-forget manual sync. Returns once
 *    the sync run has finished (typically < 2 seconds in demo) so the client
 *    can show a real result toast.
 */
export const tradesRoute = new Hono<{ Variables: AuthVariables }>();

tradesRoute.use('*', requireAuth);

/** Parse an optional ISO date query param; ignore unparseable values. */
function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

tradesRoute.get('/', async (c) => {
  const { id: userId } = c.get('user');
  const q = c.req.query();
  const body: TradesResponse = await listTrades(userId, {
    ticker: q.ticker || undefined,
    category: UnifiedCategorySchema.safeParse(q.category).data,
    side: TradeSideSchema.safeParse(q.side).data,
    action: TradeActionSchema.safeParse(q.action).data,
    from: parseDate(q.from),
    to: parseDate(q.to),
    cursor: q.cursor || undefined,
  });
  return c.json(body);
});

tradesRoute.get('/:id', async (c) => {
  const { id: userId } = c.get('user');
  const trade = await getTrade(userId, c.req.param('id'));
  if (!trade) {
    return c.json({ error: 'Trade not found' }, 404);
  }
  const body: TradeDetailResponse = { trade };
  return c.json(body);
});

/**
 * POST /trades/sync — synchronously runs one sync for the calling user.
 *
 * The spec says "returns immediately, sync runs in background". For v0 we
 * compromise: the sync usually finishes in seconds, and the client wants the
 * outcome to toast a real result. We *do* still run it on the same process
 * (no background queue yet) so the connection holds for the run.
 */
tradesRoute.post('/sync', async (c) => {
  const { id: userId } = c.get('user');
  const poller = getTradesPoller();
  if (!poller) {
    const body: SyncResponse = {
      status: 'error',
      fillsIngested: 0,
      positionsSynced: 0,
      ordersSynced: 0,
      balanceCents: 0,
      durationMs: 0,
      error: 'Trades poller is not running on this server',
    };
    return c.json(body, 503);
  }

  const result = await poller.syncUser(userId);
  const body: SyncResponse = {
    status: result.status,
    fillsIngested: result.fills,
    positionsSynced: result.positions,
    ordersSynced: result.orders,
    balanceCents: result.balanceCents,
    durationMs: result.durationMs,
    error: result.error ?? null,
  };
  return c.json(body, result.status === 'ok' ? 200 : 200);
});
