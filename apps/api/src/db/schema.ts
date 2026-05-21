import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
