import { useState } from 'react';
import {
  type PortfolioRange,
  type Position,
  type Trade,
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
import { Sparkline } from '../../components/Sparkline';
import {
  formatChange,
  formatContractCents,
  formatDollars,
  pnlColor,
} from '../../lib/format';
import {
  usePortfolioSummary,
  usePositions,
  useTrades,
} from '../../lib/portfolio';

/**
 * Dashboard — the user's home page after sign-in.
 *
 * Sections, in wireframe order:
 *  1. Portfolio value + time-range selector + equity-curve sparkline.
 *  2. Venue/cash split row (Kalshi only for v0, but the layout extends).
 *  3. Open positions list — sorted by exposure.
 *  4. Recent activity — most recent fills with a "view all" link to /trades.
 *
 * Every figure flows from `/portfolio/summary` + `/portfolio/positions` +
 * `/trades`. Numbers are integer cents on the wire; `lib/format.ts` is the
 * single place that turns them into display strings.
 */

const RANGES: PortfolioRange[] = ['1d', '1w', '1m', '3m', 'ytd', 'all'];

export default function Dashboard() {
  const [range, setRange] = useState<PortfolioRange>('1m');
  const summary = usePortfolioSummary(range);
  const positions = usePositions();
  const recent = useTrades({}); // first page, default sort = newest first

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$5" maxWidth={920} width="100%" alignSelf="center">
        <H1 fontSize="$9" fontWeight="800" color="$color">
          Dashboard
        </H1>

        <PortfolioValueCard
          range={range}
          onRangeChange={setRange}
          loading={summary.isLoading && !summary.data}
          error={summary.isError}
          data={summary.data ?? null}
        />

        <VenueSplitCard
          cashBalanceCents={summary.data?.cashBalanceCents ?? 0}
          positionsValueCents={summary.data?.positionsValueCents ?? 0}
        />

        <OpenPositionsCard
          loading={positions.isLoading && !positions.data}
          error={positions.isError}
          positions={positions.data?.positions ?? []}
        />

        <RecentActivityCard
          loading={recent.isLoading && !recent.data}
          error={recent.isError}
          trades={recent.data?.trades ?? []}
        />
      </YStack>
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section: portfolio value + equity curve                                    */
/* -------------------------------------------------------------------------- */

function PortfolioValueCard(props: {
  range: PortfolioRange;
  onRangeChange: (r: PortfolioRange) => void;
  loading: boolean;
  error: boolean;
  data: import('@polly/shared').PortfolioSummary | null;
}) {
  const { range, onRangeChange, loading, error, data } = props;
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
      <Text fontSize="$3" color="$placeholderColor">
        Portfolio value
      </Text>

      {loading ? (
        <YStack p="$4" ai="center">
          <Spinner color="$accent" size="large" />
        </YStack>
      ) : error || !data ? (
        <Text fontSize="$3" color="$red10">
          Could not load your portfolio. Pull to refresh.
        </Text>
      ) : (
        <YStack gap="$3">
          <Text fontSize="$10" fontWeight="800" color="$color">
            {formatDollars(data.totalValueCents)}
          </Text>

          <XStack gap="$2" flexWrap="wrap">
            <ChangeBadge label="Today" cents={data.todayChangeCents} />
            <ChangeBadge label="Week" cents={data.weekChangeCents} />
            <ChangeBadge label="MTD" cents={data.monthToDateChangeCents} />
            <ChangeBadge label="YTD" cents={data.yearToDateChangeCents} />
          </XStack>

          {/* Equity-curve sparkline over the selected range. */}
          <YStack gap="$1">
            <Sparkline
              points={data.equityCurve.map((p) => p.equityCents)}
              width="100%"
              height={120}
            />
            <XStack jc="space-between" ai="center">
              <Text fontSize="$2" color="$placeholderColor">
                {data.equityCurve.length} points · {range}
              </Text>
              <Text fontSize="$2" color={pnlColor(data.rangeChangeCents)}>
                {formatChange(data.rangeChangeCents)} over {range}
              </Text>
            </XStack>
          </YStack>

          {/* Range selector. Tap to switch — fetches a new summary. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack gap="$2">
              {RANGES.map((r) => {
                const active = r === range;
                return (
                  <Button
                    key={r}
                    size="$2"
                    bg={active ? '$accent' : '$background'}
                    borderWidth={1}
                    borderColor={active ? '$accent' : '$borderColor'}
                    onPress={() => onRangeChange(r)}
                  >
                    <Button.Text color={active ? 'white' : '$color'} fontWeight="600">
                      {r.toUpperCase()}
                    </Button.Text>
                  </Button>
                );
              })}
            </XStack>
          </ScrollView>
        </YStack>
      )}
    </Card>
  );
}

function ChangeBadge({ label, cents }: { label: string; cents: number }) {
  return (
    <YStack
      borderWidth={1}
      borderColor="$borderColor"
      br="$3"
      px="$3"
      py="$2"
      gap="$0.5"
      minWidth={88}
    >
      <Text fontSize="$1" color="$placeholderColor" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="700" color={pnlColor(cents)}>
        {formatChange(cents)}
      </Text>
    </YStack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section: venue / cash split                                                */
/* -------------------------------------------------------------------------- */

function VenueSplitCard(props: { cashBalanceCents: number; positionsValueCents: number }) {
  const { cashBalanceCents, positionsValueCents } = props;
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
      <Text fontSize="$5" fontWeight="700" color="$color">
        Venue split
      </Text>
      <XStack gap="$3">
        <VenueCell label="Kalshi · Cash" valueCents={cashBalanceCents} />
        <VenueCell label="Kalshi · Positions" valueCents={positionsValueCents} />
      </XStack>
      <Text fontSize="$2" color="$placeholderColor">
        v0 supports Kalshi only — more venues in a later session.
      </Text>
    </Card>
  );
}

function VenueCell({ label, valueCents }: { label: string; valueCents: number }) {
  return (
    <YStack
      flex={1}
      minWidth={0}
      borderWidth={1}
      borderColor="$borderColor"
      br="$3"
      p="$3"
      gap="$1"
    >
      <Text fontSize="$2" color="$placeholderColor">
        {label}
      </Text>
      <Text fontSize="$5" fontWeight="700" color="$color">
        {formatDollars(valueCents)}
      </Text>
    </YStack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section: open positions                                                    */
/* -------------------------------------------------------------------------- */

function OpenPositionsCard(props: {
  loading: boolean;
  error: boolean;
  positions: Position[];
}) {
  const { loading, error, positions: rows } = props;
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
      <Text fontSize="$5" fontWeight="700" color="$color">
        Open positions
      </Text>
      {loading ? (
        <YStack p="$3" ai="center">
          <Spinner color="$accent" />
        </YStack>
      ) : error ? (
        <Text fontSize="$3" color="$red10">
          Could not load positions.
        </Text>
      ) : rows.length === 0 ? (
        <Text fontSize="$3" color="$placeholderColor">
          No open positions yet. Place a trade on Kalshi — it'll appear here
          within two minutes.
        </Text>
      ) : (
        <YStack gap="$2">
          {rows.map((p) => (
            <PositionRow key={`${p.ticker}-${p.side}`} position={p} />
          ))}
        </YStack>
      )}
    </Card>
  );
}

function PositionRow({ position: p }: { position: Position }) {
  const router = useRouter();
  return (
    <XStack
      borderWidth={1}
      borderColor="$borderColor"
      br="$3"
      p="$3"
      gap="$3"
      ai="center"
      jc="space-between"
      hoverStyle={{ borderColor: '$accent' }}
      pressStyle={{ opacity: 0.85 }}
      onPress={() => router.push(`/market/${encodeURIComponent(p.ticker)}` as never)}
    >
      <YStack flex={1} minWidth={0} gap="$1">
        <Text fontSize="$3" fontWeight="600" color="$color" numberOfLines={2}>
          {p.marketTitle}
        </Text>
        <Text fontSize="$1" color="$placeholderColor" textTransform="uppercase">
          {p.category} · {p.side.toUpperCase()} · {p.count} contracts @ {formatContractCents(p.averageCostCents)}
        </Text>
      </YStack>
      <YStack ai="flex-end" gap="$0.5">
        <Text fontSize="$4" fontWeight="700" color={pnlColor(p.unrealizedPnlCents)}>
          {formatChange(p.unrealizedPnlCents)}
        </Text>
        <Text fontSize="$1" color="$placeholderColor">
          mid {formatContractCents(p.currentMidCents)}
        </Text>
      </YStack>
    </XStack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section: recent activity                                                   */
/* -------------------------------------------------------------------------- */

function RecentActivityCard(props: {
  loading: boolean;
  error: boolean;
  trades: Trade[];
}) {
  const { loading, error, trades } = props;
  const router = useRouter();
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" bg="$background">
      <XStack jc="space-between" ai="center">
        <Text fontSize="$5" fontWeight="700" color="$color">
          Recent activity
        </Text>
        <Button size="$2" chromeless onPress={() => router.push('/trades' as never)}>
          <Button.Text color="$accent" fontWeight="600">
            View all →
          </Button.Text>
        </Button>
      </XStack>
      {loading ? (
        <YStack p="$3" ai="center">
          <Spinner color="$accent" />
        </YStack>
      ) : error ? (
        <Text fontSize="$3" color="$red10">
          Could not load recent trades.
        </Text>
      ) : trades.length === 0 ? (
        <Text fontSize="$3" color="$placeholderColor">
          No fills yet.
        </Text>
      ) : (
        <YStack gap="$2">
          {trades.slice(0, 6).map((t, i) => (
            <YStack key={t.id} gap="$2">
              {i > 0 ? <Separator /> : null}
              <TradeRow trade={t} />
            </YStack>
          ))}
        </YStack>
      )}
    </Card>
  );
}

function TradeRow({ trade: t }: { trade: Trade }) {
  const router = useRouter();
  return (
    <XStack
      ai="center"
      jc="space-between"
      gap="$2"
      pressStyle={{ opacity: 0.85 }}
      onPress={() => router.push(`/trades/${t.id}` as never)}
    >
      <YStack flex={1} minWidth={0} gap="$1">
        <Text fontSize="$3" fontWeight="600" color="$color" numberOfLines={1}>
          {t.action === 'buy' ? 'Bought' : 'Sold'} {t.count} {t.side.toUpperCase()} · {t.marketTitle}
        </Text>
        <Text fontSize="$1" color="$placeholderColor">
          {new Date(t.executedAt).toLocaleString()} · @ {formatContractCents(t.priceCents)}
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
  );
}
