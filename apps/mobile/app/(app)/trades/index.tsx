import { useState } from 'react';
import {
  TradeActionSchema,
  TradeSideSchema,
  UnifiedCategorySchema,
  UNIFIED_CATEGORIES,
  type Trade,
  type TradeAction,
  type TradeSide,
  type UnifiedCategory,
} from '@polly/shared';
import { useRouter } from 'expo-router';
import {
  Button,
  Card,
  H1,
  ScrollView,
  Separator,
  Spinner,
  Text,
  XStack,
  YStack,
} from 'tamagui';
import { formatChange, formatContractCents, pnlColor } from '../../../lib/format';
import { useTrades, type TradesQueryParams } from '../../../lib/portfolio';

/**
 * Trade history list — the "view all" target from the dashboard's recent
 * activity. Supports the filters the spec calls for: category, side, action.
 * Ticker + date-range filters are wired to the API but not yet surfaced in
 * the UI (next session adds a richer filter sheet).
 */

type SideChoice = 'All' | TradeSide;
type ActionChoice = 'All' | TradeAction;
type CategoryChoice = 'All' | UnifiedCategory;

const SIDE_CHOICES: SideChoice[] = ['All', ...TradeSideSchema.options];
const ACTION_CHOICES: ActionChoice[] = ['All', ...TradeActionSchema.options];
const CATEGORY_CHOICES: CategoryChoice[] = ['All', ...UNIFIED_CATEGORIES];

export default function TradesList() {
  const router = useRouter();
  const [side, setSide] = useState<SideChoice>('All');
  const [action, setAction] = useState<ActionChoice>('All');
  const [category, setCategory] = useState<CategoryChoice>('All');

  const params: TradesQueryParams = {
    side: side === 'All' ? undefined : (UnknownToSide(side) ?? undefined),
    action: action === 'All' ? undefined : (UnknownToAction(action) ?? undefined),
    category: category === 'All' ? undefined : (UnknownToCategory(category) ?? undefined),
  };
  const trades = useTrades(params);

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$5" maxWidth={920} width="100%" alignSelf="center">
        <XStack ai="center" gap="$3">
          <Button size="$3" onPress={() => router.back()}>
            ← Back
          </Button>
          <H1 fontSize="$8" fontWeight="800" color="$color">
            Trades
          </H1>
        </XStack>

        <YStack gap="$2">
          <FilterRow label="Side" choices={SIDE_CHOICES} value={side} onChange={setSide} />
          <FilterRow label="Action" choices={ACTION_CHOICES} value={action} onChange={setAction} />
          <FilterRow
            label="Category"
            choices={CATEGORY_CHOICES}
            value={category}
            onChange={setCategory}
          />
        </YStack>

        {trades.isLoading && !trades.data ? (
          <YStack p="$8" ai="center">
            <Spinner color="$accent" size="large" />
          </YStack>
        ) : trades.isError ? (
          <Text fontSize="$3" color="$red10" textAlign="center" p="$4">
            Could not load trades.
          </Text>
        ) : (trades.data?.trades.length ?? 0) === 0 ? (
          <Text fontSize="$3" color="$placeholderColor" textAlign="center" p="$4">
            No trades match these filters yet.
          </Text>
        ) : (
          <TradesCard trades={trades.data!.trades} />
        )}
      </YStack>
    </ScrollView>
  );
}

function TradesCard({ trades }: { trades: Trade[] }) {
  const router = useRouter();
  return (
    <Card borderWidth={1} borderColor="$borderColor" bg="$background" p="$3">
      <YStack gap="$2">
        {trades.map((t, i) => (
          <YStack key={t.id} gap="$2">
            {i > 0 ? <Separator /> : null}
            <XStack
              ai="center"
              jc="space-between"
              gap="$2"
              p="$2"
              pressStyle={{ opacity: 0.85 }}
              onPress={() => router.push(`/trades/${t.id}` as never)}
            >
              <YStack flex={1} minWidth={0} gap="$1">
                <Text fontSize="$3" fontWeight="600" color="$color" numberOfLines={1}>
                  {t.action === 'buy' ? 'Bought' : 'Sold'} {t.count} {t.side.toUpperCase()} ·{' '}
                  {t.marketTitle}
                </Text>
                <Text fontSize="$1" color="$placeholderColor">
                  {new Date(t.executedAt).toLocaleString()} · {t.category} · @{' '}
                  {formatContractCents(t.priceCents)}
                </Text>
              </YStack>
              <Text
                fontSize="$3"
                fontWeight="700"
                color={t.realizedPnlCents === null ? '$placeholderColor' : pnlColor(t.realizedPnlCents)}
              >
                {t.realizedPnlCents === null ? '—' : formatChange(t.realizedPnlCents)}
              </Text>
            </XStack>
          </YStack>
        ))}
      </YStack>
    </Card>
  );
}

function FilterRow<T extends string>(props: {
  label: string;
  choices: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <YStack gap="$1">
      <Text fontSize="$2" color="$placeholderColor" textTransform="uppercase">
        {props.label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <XStack gap="$2">
          {props.choices.map((c) => {
            const active = c === props.value;
            return (
              <Button
                key={c}
                size="$2"
                bg={active ? '$accent' : '$background'}
                borderWidth={1}
                borderColor={active ? '$accent' : '$borderColor'}
                onPress={() => props.onChange(c)}
              >
                <Button.Text color={active ? 'white' : '$color'} fontWeight="600">
                  {c}
                </Button.Text>
              </Button>
            );
          })}
        </XStack>
      </ScrollView>
    </YStack>
  );
}

// `useState` of a `SideChoice` etc. unions includes the 'All' sentinel, but
// the API params only accept the typed enums. These helpers narrow the union
// without losing exhaustiveness at the call site.
function UnknownToSide(v: SideChoice): TradeSide | null {
  return TradeSideSchema.safeParse(v).data ?? null;
}
function UnknownToAction(v: ActionChoice): TradeAction | null {
  return TradeActionSchema.safeParse(v).data ?? null;
}
function UnknownToCategory(v: CategoryChoice): UnifiedCategory | null {
  return UnifiedCategorySchema.safeParse(v).data ?? null;
}
