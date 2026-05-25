import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import {
  DiscoverResponseSchema,
  MarketDetailSchema,
  MarketSearchResponseSchema,
  type DiscoverResponse,
  type MarketDetail,
  type MarketSearchResponse,
  type MarketSort,
  type MarketStatus,
  type UnifiedCategory,
} from '@polly/shared';
import { apiJson } from './api';

/**
 * Markets data layer.
 *
 * Each hook owns one cache slice (discover / search / detail) and parses the
 * response through the shared Zod schema before handing typed data to the UI.
 * Stale times come from the spec: discover 2 min, detail 1 min, search 5 min.
 */

const TWO_MIN = 2 * 60_000;
const ONE_MIN = 60_000;
const FIVE_MIN = 5 * 60_000;

/** Search query the client sends — dates are pre-stringified for the wire. */
export interface ClientSearchParams {
  q?: string;
  category?: UnifiedCategory;
  venue?: string;
  status?: MarketStatus;
  sort?: MarketSort;
  resolvesAfter?: string;
  resolvesBefore?: string;
  cursor?: string;
}

/** Build a `?` query string, dropping empty/undefined values. */
function toQuery(params: ClientSearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/** `GET /markets/discover` — cached two minutes per the spec. */
export function useDiscover(
  options?: Omit<UseQueryOptions<DiscoverResponse>, 'queryKey' | 'queryFn' | 'staleTime'>,
) {
  return useQuery<DiscoverResponse>({
    queryKey: ['/markets/discover'],
    queryFn: async () => DiscoverResponseSchema.parse(await apiJson('/markets/discover')),
    staleTime: TWO_MIN,
    ...options,
  });
}

/** `GET /markets/search` — cached five minutes per the spec. */
export function useMarketSearch(params: ClientSearchParams) {
  return useQuery<MarketSearchResponse>({
    queryKey: ['/markets/search', params],
    queryFn: async () =>
      MarketSearchResponseSchema.parse(await apiJson(`/markets/search${toQuery(params)}`)),
    staleTime: FIVE_MIN,
    placeholderData: (prev) => prev, // smooth UI as filters change
  });
}

/** `GET /markets/:ticker` — cached one minute per the spec. */
export function useMarketDetail(ticker: string | undefined) {
  return useQuery<MarketDetail>({
    queryKey: ['/markets', ticker],
    queryFn: async () =>
      MarketDetailSchema.parse(await apiJson(`/markets/${encodeURIComponent(ticker!)}`)),
    enabled: Boolean(ticker),
    staleTime: ONE_MIN,
  });
}
