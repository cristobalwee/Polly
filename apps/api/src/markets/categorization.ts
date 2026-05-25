import type { UnifiedCategory } from '@polly/shared';
import { UnifiedCategorySchema } from '@polly/shared';
import { db } from '../db/client';
import { marketCategoriesMapping, type MarketCategoryMappingRow } from '../db/schema';

/**
 * Editorial categorisation: Kalshi's native categories → polly's unified
 * taxonomy (`Weather` · `Economics` · `Politics` · `Sports` · `Crypto` ·
 * `Culture` · `Other`).
 *
 * The `market_categories_mapping` table is the source of truth; this module
 * seeds it and builds an in-memory lookup the poller uses to classify markets
 * without a database round-trip per market.
 */

/* -------------------------------------------------------------------------- */
/*  Seed data — the editorial mapping                                          */
/* -------------------------------------------------------------------------- */

type SeedRow = {
  kalshiCategory: string;
  kalshiSubcategory: string | null;
  unifiedCategory: UnifiedCategory;
  unifiedSubcategory: string | null;
};

/**
 * The editorial seed. Kalshi's category vocabulary drifts over time and
 * differs slightly between demo and production, so we map every form we have
 * seen onto a unified category. Markets whose Kalshi category matches nothing
 * here fall through to `Other` (handled by the categoriser, not seeded).
 *
 * Weather carries subcategories — they are genuinely useful for filtering —
 * keyed off a subcategory string the poller derives from the market title.
 */
const CATEGORY_SEED: SeedRow[] = [
  // Weather (+ subcategories).
  { kalshiCategory: 'Climate and Weather', kalshiSubcategory: null, unifiedCategory: 'Weather', unifiedSubcategory: null },
  { kalshiCategory: 'Climate and Weather', kalshiSubcategory: 'Temperature', unifiedCategory: 'Weather', unifiedSubcategory: 'temperature' },
  { kalshiCategory: 'Climate and Weather', kalshiSubcategory: 'Precipitation', unifiedCategory: 'Weather', unifiedSubcategory: 'precipitation' },
  { kalshiCategory: 'Climate and Weather', kalshiSubcategory: 'Hurricane', unifiedCategory: 'Weather', unifiedSubcategory: 'hurricane' },
  { kalshiCategory: 'Weather', kalshiSubcategory: null, unifiedCategory: 'Weather', unifiedSubcategory: null },
  { kalshiCategory: 'Weather', kalshiSubcategory: 'Temperature', unifiedCategory: 'Weather', unifiedSubcategory: 'temperature' },
  { kalshiCategory: 'Weather', kalshiSubcategory: 'Precipitation', unifiedCategory: 'Weather', unifiedSubcategory: 'precipitation' },
  { kalshiCategory: 'Weather', kalshiSubcategory: 'Hurricane', unifiedCategory: 'Weather', unifiedSubcategory: 'hurricane' },
  { kalshiCategory: 'Climate', kalshiSubcategory: null, unifiedCategory: 'Weather', unifiedSubcategory: null },

  // Economics.
  { kalshiCategory: 'Economics', kalshiSubcategory: null, unifiedCategory: 'Economics', unifiedSubcategory: null },
  { kalshiCategory: 'Financials', kalshiSubcategory: null, unifiedCategory: 'Economics', unifiedSubcategory: null },
  { kalshiCategory: 'Financial', kalshiSubcategory: null, unifiedCategory: 'Economics', unifiedSubcategory: null },
  { kalshiCategory: 'Companies', kalshiSubcategory: null, unifiedCategory: 'Economics', unifiedSubcategory: null },
  { kalshiCategory: 'Indices', kalshiSubcategory: null, unifiedCategory: 'Economics', unifiedSubcategory: null },

  // Politics.
  { kalshiCategory: 'Politics', kalshiSubcategory: null, unifiedCategory: 'Politics', unifiedSubcategory: null },
  { kalshiCategory: 'Elections', kalshiSubcategory: null, unifiedCategory: 'Politics', unifiedSubcategory: null },
  { kalshiCategory: 'World', kalshiSubcategory: null, unifiedCategory: 'Politics', unifiedSubcategory: null },
  { kalshiCategory: 'Government', kalshiSubcategory: null, unifiedCategory: 'Politics', unifiedSubcategory: null },

  // Sports.
  { kalshiCategory: 'Sports', kalshiSubcategory: null, unifiedCategory: 'Sports', unifiedSubcategory: null },

  // Crypto.
  { kalshiCategory: 'Crypto', kalshiSubcategory: null, unifiedCategory: 'Crypto', unifiedSubcategory: null },
  { kalshiCategory: 'Cryptocurrency', kalshiSubcategory: null, unifiedCategory: 'Crypto', unifiedSubcategory: null },

  // Culture.
  { kalshiCategory: 'Culture', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Entertainment', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Science and Technology', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Technology', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Science', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Health', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Transportation', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
  { kalshiCategory: 'Social', kalshiSubcategory: null, unifiedCategory: 'Culture', unifiedSubcategory: null },
];

/**
 * Seed `market_categories_mapping` if it is empty.
 *
 * Idempotent: it runs inside the poller's startup and on a fresh database it
 * inserts the editorial mapping; on a database that already has rows it does
 * nothing, so re-running the poller never duplicates or clobbers hand edits.
 */
export async function seedCategoryMappings(): Promise<number> {
  const existing = await db.select({ id: marketCategoriesMapping.id }).from(marketCategoriesMapping).limit(1);
  if (existing.length > 0) return 0;

  await db.insert(marketCategoriesMapping).values(
    CATEGORY_SEED.map((r) => ({
      kalshiCategory: r.kalshiCategory,
      kalshiSubcategory: r.kalshiSubcategory,
      unifiedCategory: r.unifiedCategory,
      unifiedSubcategory: r.unifiedSubcategory,
    })),
  );
  return CATEGORY_SEED.length;
}

/* -------------------------------------------------------------------------- */
/*  In-memory categoriser                                                      */
/* -------------------------------------------------------------------------- */

export type Categorisation = { category: UnifiedCategory; subcategory: string | null };

const FALLBACK: Categorisation = { category: 'Other', subcategory: null };

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * Keyword cues for weather subcategories. Kalshi does not expose a clean
 * subcategory field, so for weather markets we derive one from the title.
 */
function deriveWeatherSubcategory(title: string): string | null {
  const t = title.toLowerCase();
  if (/hurricane|cyclone|tropical storm/.test(t)) return 'Hurricane';
  if (/rain|snow|precip|inches of/.test(t)) return 'Precipitation';
  if (/temp|degrees|hottest|coldest|high in|low in/.test(t)) return 'Temperature';
  return null;
}

/**
 * A categoriser closed over a snapshot of the mapping table. Build one per
 * poll with `loadCategoriser()`; call it per market.
 */
export type Categoriser = (kalshiCategory: string | null | undefined, title: string) => Categorisation;

/** Build a categoriser from an explicit set of mapping rows (used by tests). */
export function buildCategoriser(rows: MarketCategoryMappingRow[]): Categoriser {
  // Index: `category` → (`subcategory` | '') → unified pair.
  const byCategory = new Map<string, Map<string, Categorisation>>();
  for (const row of rows) {
    const parsedCategory = UnifiedCategorySchema.safeParse(row.unifiedCategory);
    if (!parsedCategory.success) continue; // ignore a malformed hand edit
    const cat = byCategory.get(norm(row.kalshiCategory)) ?? new Map();
    cat.set(norm(row.kalshiSubcategory), {
      category: parsedCategory.data,
      subcategory: row.unifiedSubcategory,
    });
    byCategory.set(norm(row.kalshiCategory), cat);
  }

  return (kalshiCategory, title) => {
    const cat = byCategory.get(norm(kalshiCategory));
    if (!cat) return FALLBACK;

    // Weather markets get a title-derived subcategory; try it first, then the
    // category-wide default (the row with a null subcategory).
    const isWeather = [...cat.values()].some((c) => c.category === 'Weather');
    if (isWeather) {
      const sub = deriveWeatherSubcategory(title);
      if (sub) {
        const match = cat.get(norm(sub));
        if (match) return match;
      }
    }
    return cat.get('') ?? [...cat.values()][0] ?? FALLBACK;
  };
}

/**
 * Load the mapping table and build a categoriser from it. Seeds the table on
 * the fly if it is empty, so a fresh deployment (or a test that has just
 * truncated it) still produces a working categoriser without the caller
 * having to remember to seed first.
 */
export async function loadCategoriser(): Promise<Categoriser> {
  let rows = await db.select().from(marketCategoriesMapping);
  if (rows.length === 0) {
    await seedCategoryMappings();
    rows = await db.select().from(marketCategoriesMapping);
  }
  return buildCategoriser(rows);
}
