import type { MarketSummary } from '@polly/shared';
import { useMedia, Text, XStack, YStack } from 'tamagui';
import { MarketCard } from './MarketCard';

/**
 * One editorial section on the Markets page: a heading, a one-line subhead,
 * and a 3-column grid of `MarketCard`s on desktop that collapses to a single
 * stack on mobile.
 *
 * The grid is hand-rolled with `XStack flex={1}` cells rather than a CSS grid
 * because Tamagui targets both native and web and `flex` is the only layout
 * primitive that behaves identically on both. `flexBasis: 0` plus `minWidth: 0`
 * lets cards genuinely share width — without `minWidth`, long titles push
 * cells to overflow the row on web.
 */

export interface MarketSectionProps {
  title: string;
  subtitle?: string;
  markets: MarketSummary[];
  /** Rendered in place of the grid when `markets` is empty. */
  emptyMessage?: string;
}

/** Pad a row to three cells with `null` placeholders so widths stay even. */
function padRow<T>(row: T[], size: number): (T | null)[] {
  if (row.length === size) return row;
  return [...row, ...Array<null>(size - row.length).fill(null)];
}

/** Split markets into rows of `columns` items each. */
function intoRows<T>(items: T[], columns: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    out.push(items.slice(i, i + columns));
  }
  return out;
}

export function MarketSection({ title, subtitle, markets, emptyMessage }: MarketSectionProps) {
  const media = useMedia();
  const columns = media.gtSm ? 3 : 1;
  const rows = intoRows(markets, columns);

  return (
    <YStack gap="$3">
      <YStack gap="$1">
        <Text fontSize="$6" fontWeight="700" color="$color">
          {title}
        </Text>
        {subtitle ? (
          <Text fontSize="$3" color="$placeholderColor">
            {subtitle}
          </Text>
        ) : null}
      </YStack>

      {markets.length === 0 ? (
        <YStack
          borderWidth={1}
          borderColor="$borderColor"
          br="$3"
          p="$4"
          ai="center"
          jc="center"
        >
          <Text fontSize="$3" color="$placeholderColor" textAlign="center">
            {emptyMessage ?? 'Nothing to show here yet.'}
          </Text>
        </YStack>
      ) : (
        <YStack gap="$3">
          {rows.map((row, rowIdx) => (
            <XStack key={rowIdx} gap="$3">
              {padRow(row, columns).map((m, i) =>
                m ? (
                  <MarketCard key={m.ticker} market={m} />
                ) : (
                  // Invisible spacer keeps the last row's cards the same width
                  // as the rows above. flex:1 + minWidth:0 mirrors `MarketCard`.
                  <YStack key={`pad-${i}`} flex={1} minWidth={0} />
                ),
              )}
            </XStack>
          ))}
        </YStack>
      )}
    </YStack>
  );
}
