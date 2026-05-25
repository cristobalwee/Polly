import {
  OrdersResponseSchema,
  PortfolioSummarySchema,
  PositionsResponseSchema,
  SyncResponseSchema,
  TradeDetailResponseSchema,
  TradesResponseSchema,
  type OrdersResponse,
  type PortfolioRange,
  type PortfolioSummary,
  type PositionsResponse,
  type SyncResponse,
  type TradeAction,
  type TradeDetailResponse,
  type TradeSide,
  type TradesResponse,
  type UnifiedCategory,
} from '@polly/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiJson } from './api';

/**
 * Data layer for portfolio + trades.
 *
 * Each hook owns one cache slice (summary / positions / orders / trades /
 * trade detail) and parses the response through the shared Zod schema before
 * handing it to the UI. Stale times are tuned to the dashboard's polling
 * cadence: balance + positions refresh every 60s, trades less often.
 */

const ONE_MIN = 60_000;
const TWO_MIN = 2 * 60_000;
const FIVE_MIN = 5 * 60_000;

/** Build a `?…` query string, dropping empty/undefined values. */
function toQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** `GET /portfolio/summary?range=…` */
export function usePortfolioSummary(
  range: PortfolioRange,
  options?: Omit<
    UseQueryOptions<PortfolioSummary>,
    'queryKey' | 'queryFn' | 'staleTime'
  >,
) {
  return useQuery<PortfolioSummary>({
    queryKey: ['/portfolio/summary', range],
    queryFn: async () =>
      PortfolioSummarySchema.parse(await apiJson(`/portfolio/summary?range=${range}`)),
    staleTime: ONE_MIN,
    ...options,
  });
}

/** `GET /portfolio/positions` — open positions with live unrealised P&L. */
export function usePositions() {
  return useQuery<PositionsResponse>({
    queryKey: ['/portfolio/positions'],
    queryFn: async () => PositionsResponseSchema.parse(await apiJson('/portfolio/positions')),
    staleTime: ONE_MIN,
  });
}

/** `GET /portfolio/orders` — pending limit orders. */
export function useOrders() {
  return useQuery<OrdersResponse>({
    queryKey: ['/portfolio/orders'],
    queryFn: async () => OrdersResponseSchema.parse(await apiJson('/portfolio/orders')),
    staleTime: TWO_MIN,
  });
}

export interface TradesQueryParams {
  ticker?: string;
  category?: UnifiedCategory;
  side?: TradeSide;
  action?: TradeAction;
  from?: string;
  to?: string;
  cursor?: string;
}

/** `GET /trades?…` — paginated trade history with filters. */
export function useTrades(params: TradesQueryParams = {}) {
  const qs = toQuery({
    ticker: params.ticker,
    category: params.category,
    side: params.side,
    action: params.action,
    from: params.from,
    to: params.to,
    cursor: params.cursor,
  });
  return useQuery<TradesResponse>({
    queryKey: ['/trades', params],
    queryFn: async () => TradesResponseSchema.parse(await apiJson(`/trades${qs}`)),
    staleTime: FIVE_MIN,
    placeholderData: (prev) => prev,
  });
}

/** `GET /trades/:id` — single trade. */
export function useTradeDetail(id: string | undefined) {
  return useQuery<TradeDetailResponse>({
    queryKey: ['/trades', 'detail', id],
    queryFn: async () =>
      TradeDetailResponseSchema.parse(await apiJson(`/trades/${encodeURIComponent(id!)}`)),
    enabled: Boolean(id),
    staleTime: FIVE_MIN,
  });
}

/**
 * `POST /trades/sync` — manual sync. On success, invalidates every portfolio
 * cache slice so the dashboard reflects fresh data immediately.
 */
export function useManualSync() {
  const queryClient = useQueryClient();
  return useMutation<SyncResponse>({
    mutationFn: async () =>
      SyncResponseSchema.parse(await apiJson('/trades/sync', { method: 'POST' })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['/portfolio/summary'] });
      void queryClient.invalidateQueries({ queryKey: ['/portfolio/positions'] });
      void queryClient.invalidateQueries({ queryKey: ['/portfolio/orders'] });
      void queryClient.invalidateQueries({ queryKey: ['/trades'] });
    },
  });
}
