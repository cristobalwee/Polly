import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, ScrollView, Separator, Spinner, Text, XStack, YStack } from 'tamagui';
import { Sparkline } from '../../../components/Sparkline';
import { useMarketDetail } from '../../../lib/markets';

/**
 * Market detail — intentionally a stub for this session.
 *
 * What it shows today: the title and category, current YES / NO snapshot, a
 * large sparkline of recent price history (empty until the engagement-driven
 * candlestick poll has data), and a placeholder "Watch" button. Watchlist
 * functionality lands in a later session — the button exists so the screen
 * looks finished and the layout is locked in.
 */

/** Format an integer cents price; `null` shows as an em dash. */
function formatCents(value: number | null): string {
  return value === null ? '—' : `${value}¢`;
}

function formatResolution(iso: string | null): string {
  if (!iso) return 'No resolution date';
  return `Resolves ${new Date(iso).toLocaleString()}`;
}

export default function MarketDetail() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  const router = useRouter();
  const detail = useMarketDetail(ticker);

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$4" maxWidth={720} width="100%" alignSelf="center">
        <Button alignSelf="flex-start" size="$3" onPress={() => router.back()}>
          ← Back
        </Button>

        {detail.isLoading ? (
          <YStack p="$8" ai="center" jc="center">
            <Spinner color="$accent" size="large" />
          </YStack>
        ) : detail.isError || !detail.data ? (
          <Text fontSize="$3" color="$red10" textAlign="center" p="$4">
            Could not load this market.
          </Text>
        ) : (
          <DetailBody data={detail.data} />
        )}
      </YStack>
    </ScrollView>
  );
}

function DetailBody({ data }: { data: NonNullable<ReturnType<typeof useMarketDetail>['data']> }) {
  const sparkline = data.priceHistory.map((p) => p.yesMidCents);
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontSize="$2" color="$placeholderColor" textTransform="uppercase">
          {data.category}
          {data.subcategory ? ` · ${data.subcategory}` : ''}
        </Text>
        <Text fontSize="$8" fontWeight="800" color="$color">
          {data.title}
        </Text>
        {data.subtitle ? (
          <Text fontSize="$4" color="$placeholderColor">
            {data.subtitle}
          </Text>
        ) : null}
        <Text fontSize="$3" color="$placeholderColor">
          {formatResolution(data.resolutionDate)}
        </Text>
      </YStack>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
        <Text fontSize="$5" fontWeight="700" color="$color">
          Current prices
        </Text>
        <XStack jc="space-between">
          <PriceCell label="YES bid" value={data.yesBid} />
          <PriceCell label="YES ask" value={data.yesAsk} />
          <PriceCell label="NO bid" value={data.noBid} />
          <PriceCell label="NO ask" value={data.noAsk} />
        </XStack>
        <Separator />
        <YStack gap="$2">
          <Text fontSize="$3" color="$placeholderColor">
            YES mid, recent history
          </Text>
          <Sparkline points={sparkline} width="100%" height={120} />
          {sparkline.length === 0 ? (
            <Text fontSize="$2" color="$placeholderColor">
              Price history appears once this market is in a watchlist or position.
            </Text>
          ) : null}
        </YStack>
      </Card>

      <Button bg="$backgroundHover" disabled>
        <Button.Text color="$placeholderColor">Watch (coming soon)</Button.Text>
      </Button>
    </YStack>
  );
}

function PriceCell({ label, value }: { label: string; value: number | null }) {
  return (
    <YStack ai="center" gap="$1">
      <Text fontSize="$1" color="$placeholderColor">
        {label}
      </Text>
      <Text fontSize="$5" fontWeight="700" color="$color">
        {formatCents(value)}
      </Text>
    </YStack>
  );
}
