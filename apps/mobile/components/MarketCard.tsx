import type { MarketSummary } from '@polly/shared';
import { useRouter } from 'expo-router';
import { Card, Text, XStack, YStack } from 'tamagui';
import { Sparkline } from './Sparkline';

/**
 * One market in the discover / search grids.
 *
 * Tapping anywhere on the card navigates to `/market/:ticker`. The yes/no row
 * uses simple text rather than a chart of its own — the sparkline already
 * carries the price-over-time story, this row is the current snapshot.
 *
 * Cents → display: a 0-100 cents value renders as the `¢` figure (so "57¢"),
 * which matches how Kalshi quotes binary contracts in their own UI.
 */

export interface MarketCardProps {
  market: MarketSummary;
}

/** Format an integer cents price; `null` shows as an em dash. */
function formatCents(value: number | null): string {
  if (value === null) return '—';
  return `${value}¢`;
}

/** Approximate "resolves in N days" — coarse on purpose, the card is tiny. */
function relativeResolution(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms < 0) return 'resolved';
  const days = Math.round(ms / (24 * 60 * 60_000));
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days}d`;
  const months = Math.round(days / 30);
  return `in ${months}mo`;
}

export function MarketCard({ market }: MarketCardProps) {
  const router = useRouter();
  const resolves = relativeResolution(market.resolutionDate);

  return (
    <Card
      hoverStyle={{ borderColor: '$accent' }}
      pressStyle={{ opacity: 0.85 }}
      borderWidth={1}
      borderColor="$borderColor"
      bg="$background"
      p="$3"
      gap="$2"
      onPress={() => router.push(`/market/${encodeURIComponent(market.ticker)}` as never)}
      flex={1}
      minWidth={0}
    >
      <YStack gap="$1" minHeight={56}>
        <XStack jc="space-between" gap="$2">
          <Text fontSize="$1" color="$placeholderColor" textTransform="uppercase">
            {market.category}
            {market.subcategory ? ` · ${market.subcategory}` : ''}
          </Text>
          {resolves ? (
            <Text fontSize="$1" color="$placeholderColor">
              {resolves}
            </Text>
          ) : null}
        </XStack>
        <Text fontSize="$3" fontWeight="600" color="$color" numberOfLines={2}>
          {market.title}
        </Text>
      </YStack>

      <Sparkline points={market.sparkline} />

      <XStack jc="space-between" ai="center">
        <YStack>
          <Text fontSize="$1" color="$placeholderColor">
            YES
          </Text>
          <Text fontSize="$4" fontWeight="700" color="$color">
            {formatCents(market.yesAsk ?? market.yesBid)}
          </Text>
        </YStack>
        <YStack ai="flex-end">
          <Text fontSize="$1" color="$placeholderColor">
            NO
          </Text>
          <Text fontSize="$4" fontWeight="700" color="$color">
            {formatCents(market.noAsk ?? market.noBid)}
          </Text>
        </YStack>
      </XStack>
    </Card>
  );
}
