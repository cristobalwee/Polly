import {
  bigint,
  bigserial,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth-schema';

export * from './auth-schema';

/**
 * Postgres `bytea`. Drizzle has no first-class binary column, so we declare a
 * custom type: values round-trip as Node `Buffer`s, which is exactly what the
 * envelope-encryption module produces and consumes.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * A user's stored Kalshi API credential, protected by envelope encryption.
 *
 * The Kalshi RSA private key is encrypted under a random per-credential data
 * encryption key (DEK); the DEK itself is encrypted under the server's master
 * key. See `crypto/envelope.ts` for the column-by-column layout. Reading any of
 * this back into plaintext requires *both* the master key (env) and the row.
 *
 * One credential per user for v0 — enforced by a unique index on `user_id`.
 */
export const userKalshiCredentials = pgTable('user_kalshi_credentials', {
  id: uuid('id').defaultRandom().primaryKey(),

  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),

  /** Kalshi RSA private key, AES-256-GCM ciphertext (sealed under the DEK). */
  encryptedPrivateKey: bytea('encrypted_private_key').notNull(),

  /**
   * The DEK, sealed under the master key. Stored as a self-describing blob:
   * `[12-byte IV][16-byte GCM auth tag][ciphertext]` — see `envelope.ts`.
   */
  encryptedDek: bytea('encrypted_dek').notNull(),

  /** IV for the private-key encryption above. */
  iv: bytea('iv').notNull(),

  /** GCM auth tag for the private-key encryption above. */
  authTag: bytea('auth_tag').notNull(),

  /** Kalshi-issued API key id — the public half, sent as a request header. */
  keyId: text('key_id').notNull(),

  /** `'demo'` or `'production'`. */
  environment: text('environment').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),

  /** `'unvalidated' | 'valid' | 'invalid'` — last result of a Kalshi test call. */
  validationStatus: text('validation_status').notNull().default('unvalidated'),
});

export type UserKalshiCredentialRow = typeof userKalshiCredentials.$inferSelect;

/* -------------------------------------------------------------------------- */
/*  Markets — public, shared-across-all-users Kalshi data                      */
/* -------------------------------------------------------------------------- */

/**
 * One row per Kalshi market. This is public data — the same for every user —
 * kept fresh by the `MarketsPoller`. Prices are integer cents (0–100); the
 * `*_cents` volume columns are notional dollar volume in cents.
 *
 * `status` is polly's normalised lifecycle (`active` / `closed` / `resolved` /
 * `unopened`), not Kalshi's raw vocabulary — see `kalshi/normalise.ts`.
 * `category` / `subcategory` are the editorial taxonomy assigned at upsert time
 * from `marketCategoriesMapping`.
 */
export const markets = pgTable('markets', {
  ticker: text('ticker').primaryKey(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  category: text('category').notNull().default('Other'),
  subcategory: text('subcategory'),
  yesSubTitle: text('yes_sub_title'),
  noSubTitle: text('no_sub_title'),
  status: text('status').notNull(),
  resolutionDate: timestamp('resolution_date', { withTimezone: true }),
  yesBid: integer('yes_bid'),
  yesAsk: integer('yes_ask'),
  noBid: integer('no_bid'),
  noAsk: integer('no_ask'),
  volume24hCents: bigint('volume_24h_cents', { mode: 'number' }).notNull().default(0),
  totalVolumeCents: bigint('total_volume_cents', { mode: 'number' }).notNull().default(0),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type MarketRow = typeof markets.$inferSelect;
export type MarketInsert = typeof markets.$inferInsert;

/**
 * Editorial taxonomy mapping: Kalshi's native `(category, subcategory)` pairs
 * onto polly's unified taxonomy. Seeded by `markets/categorization.ts`; markets
 * whose Kalshi category matches no row fall through to `Other`.
 *
 * `kalshiSubcategory` is nullable — a row with a null subcategory is the
 * category-wide default, used when no subcategory-specific row matches.
 */
export const marketCategoriesMapping = pgTable('market_categories_mapping', {
  id: uuid('id').defaultRandom().primaryKey(),
  kalshiCategory: text('kalshi_category').notNull(),
  kalshiSubcategory: text('kalshi_subcategory'),
  unifiedCategory: text('unified_category').notNull(),
  unifiedSubcategory: text('unified_subcategory'),
});

export type MarketCategoryMappingRow = typeof marketCategoriesMapping.$inferSelect;

/**
 * Time series of YES-mid price and volume for *engaged* markets only — those
 * in some user's watchlist, positions, or recently viewed. The poller fetches
 * Kalshi candlesticks for these and upserts points here; discover/detail
 * endpoints read them back for sparklines and charts.
 *
 * The `(ticker, timestamp desc)` index serves the "latest N points for a
 * market" query that every sparkline issues.
 */
export const marketPriceHistory = pgTable(
  'market_price_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ticker: text('ticker')
      .notNull()
      .references(() => markets.ticker, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    yesMidCents: integer('yes_mid_cents').notNull(),
    volumeCents: bigint('volume_cents', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    index('market_price_history_ticker_ts_idx').on(t.ticker, t.timestamp.desc()),
    // A market+timestamp pair is unique, so re-running the poller over the same
    // candlestick window updates rather than duplicates — this is what makes
    // the poller idempotent for price history.
    uniqueIndex('market_price_history_ticker_ts_unique').on(t.ticker, t.timestamp),
  ],
);

export type MarketPriceHistoryRow = typeof marketPriceHistory.$inferSelect;
export type MarketPriceHistoryInsert = typeof marketPriceHistory.$inferInsert;
