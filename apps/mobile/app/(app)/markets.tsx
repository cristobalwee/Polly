import { useMemo, useState, type ReactNode } from 'react';
import { UNIFIED_CATEGORIES, type UnifiedCategory } from '@polly/shared';
import {
  Button,
  H1,
  Input,
  ScrollView,
  Spinner,
  Text,
  XStack,
  YStack,
} from 'tamagui';
import { MarketSection } from '../../components/MarketSection';
import { useDiscover, useMarketSearch } from '../../lib/markets';

/**
 * Markets — discover + search.
 *
 *  - With no query string and no category filter we render the three discover
 *    sections (trending / resolving soon / for you).
 *  - The moment the user types or picks a category we switch the body to a
 *    single search result list so they only see what they asked for.
 */

/** "All" is the no-filter sentinel for the category pills. */
type CategoryChoice = 'All' | UnifiedCategory;
const CATEGORY_CHOICES: CategoryChoice[] = ['All', ...UNIFIED_CATEGORIES];

export default function Markets() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryChoice>('All');

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0 || category !== 'All';

  const discover = useDiscover({ enabled: !isSearching });
  const search = useMarketSearch({
    q: trimmedQuery || undefined,
    category: category === 'All' ? undefined : category,
  });

  const sections = discover.data;
  const results = search.data;

  const trendingSubtitle = useMemo(() => 'Highest 24-hour volume right now', []);

  return (
    <ScrollView flex={1} bg="$background" contentContainerStyle={{ padding: 20 }}>
      <YStack gap="$5" maxWidth={1100} width="100%" alignSelf="center">
        <H1 fontSize="$9" fontWeight="800" color="$color">
          Markets
        </H1>

        {/* Search + category filter row. */}
        <YStack gap="$3">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search markets…"
            autoCapitalize="none"
            autoCorrect={false}
            size="$4"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <XStack gap="$2">
              {CATEGORY_CHOICES.map((c) => {
                const active = category === c;
                return (
                  <Button
                    key={c}
                    size="$3"
                    bg={active ? '$accent' : '$background'}
                    borderWidth={1}
                    borderColor={active ? '$accent' : '$borderColor'}
                    onPress={() => setCategory(c)}
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

        {isSearching ? (
          <SearchResults
            isLoading={search.isLoading && !results}
            isError={search.isError}
            section={
              <MarketSection
                title={trimmedQuery ? `Results for "${trimmedQuery}"` : `${category} markets`}
                markets={results?.markets ?? []}
                emptyMessage="No markets match these filters."
              />
            }
          />
        ) : (
          <DiscoverBody
            isLoading={discover.isLoading && !sections}
            isError={discover.isError}
            sections={sections}
            trendingSubtitle={trendingSubtitle}
          />
        )}
      </YStack>
    </ScrollView>
  );
}

/** Branches over loading / error / data for the discover view. */
function DiscoverBody(props: {
  isLoading: boolean;
  isError: boolean;
  sections: ReturnType<typeof useDiscover>['data'];
  trendingSubtitle: string;
}) {
  const { isLoading, isError, sections, trendingSubtitle } = props;
  if (isLoading) {
    return (
      <YStack ai="center" jc="center" p="$8">
        <Spinner color="$accent" size="large" />
      </YStack>
    );
  }
  if (isError || !sections) {
    return (
      <Text fontSize="$3" color="$red10" textAlign="center" p="$4">
        Could not load markets. Pull to refresh, or try again in a moment.
      </Text>
    );
  }
  return (
    <YStack gap="$6">
      <MarketSection
        title="Trending"
        subtitle={trendingSubtitle}
        markets={sections.trending}
        emptyMessage="Markets are loading from Kalshi. Check back in a few minutes."
      />
      <MarketSection
        title="Resolving soon"
        subtitle="Active markets resolving in the next seven days"
        markets={sections.resolvingSoon}
        emptyMessage="No markets are resolving in the next week."
      />
      <MarketSection
        title="In your categories"
        subtitle="Picks from the categories you've traded in"
        markets={sections.forYou}
        emptyMessage="Once you start trading, your favourite categories will show up here."
      />
    </YStack>
  );
}

/** Branches over loading / error / data for the search view. */
function SearchResults(props: { isLoading: boolean; isError: boolean; section: ReactNode }) {
  if (props.isLoading) {
    return (
      <YStack ai="center" jc="center" p="$8">
        <Spinner color="$accent" size="large" />
      </YStack>
    );
  }
  if (props.isError) {
    return (
      <Text fontSize="$3" color="$red10" textAlign="center" p="$4">
        Search failed. Try again in a moment.
      </Text>
    );
  }
  return <>{props.section}</>;
}
