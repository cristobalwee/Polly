import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Card, ScrollView, Separator, Spinner, Text, XStack, YStack } from 'tamagui';
import {
  formatChange,
  formatContractCents,
  formatDollars,
  pnlColor,
} from '../../../lib/format';
import { useTradeDetail } from '../../../lib/portfolio';

/**
 * Single trade detail. Shows the canonical fields: market, side, count,
 * price, fee, realised P&L (when closing), and the execution timestamp.
 */
export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const detail = useTradeDetail(id);

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$4" maxWidth={720} width="100%" alignSelf="center">
        <Button alignSelf="flex-start" size="$3" onPress={() => router.back()}>
          ← Back
        </Button>

        {detail.isLoading ? (
          <YStack p="$8" ai="center">
            <Spinner color="$accent" size="large" />
          </YStack>
        ) : detail.isError || !detail.data ? (
          <Text fontSize="$3" color="$red10" textAlign="center" p="$4">
            Could not load this trade.
          </Text>
        ) : (
          <DetailBody trade={detail.data.trade} />
        )}
      </YStack>
    </ScrollView>
  );
}

function DetailBody({ trade: t }: { trade: import('@polly/shared').Trade }) {
  // Cash flow of the fill itself: buys are negative cash, sells positive.
  const cashFlowCents =
    (t.action === 'buy' ? -1 : 1) * t.priceCents * t.count - t.feeCents;
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontSize="$2" color="$placeholderColor" textTransform="uppercase">
          {t.category}
          {t.subcategory ? ` · ${t.subcategory}` : ''}
        </Text>
        <Text fontSize="$8" fontWeight="800" color="$color">
          {t.marketTitle}
        </Text>
        <Text fontSize="$4" color="$placeholderColor">
          {t.action === 'buy' ? 'Bought' : 'Sold'} {t.count} {t.side.toUpperCase()} contracts
        </Text>
      </YStack>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
        <Row label="Executed at" value={new Date(t.executedAt).toLocaleString()} />
        <Separator />
        <Row label="Price per contract" value={formatContractCents(t.priceCents)} />
        <Row label="Fees" value={formatDollars(t.feeCents)} />
        <Row label="Net cash flow" value={formatChange(cashFlowCents)} color={pnlColor(cashFlowCents)} />
        <Separator />
        <Row
          label="Realised P&L"
          value={t.realizedPnlCents === null ? '— (opening trade)' : formatChange(t.realizedPnlCents)}
          color={t.realizedPnlCents === null ? '$placeholderColor' : pnlColor(t.realizedPnlCents)}
        />
      </Card>

      <Text fontSize="$2" color="$placeholderColor">
        Tags & notes arrive in a later session.
      </Text>
    </YStack>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <XStack jc="space-between" ai="center">
      <Text fontSize="$3" color="$placeholderColor">
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="600" color={color ?? '$color'}>
        {value}
      </Text>
    </XStack>
  );
}
