import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 *  - `generate` diffs `src/db/schema.ts` (Better Auth tables + our application
 *    tables) and writes SQL migrations into `./drizzle`.
 *  - `migrate` is run by `src/db/migrate.ts` against `DATABASE_URL`.
 *
 * `DATABASE_URL` is only needed for the database-touching commands (`migrate`,
 * `studio`); `generate` works offline.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
