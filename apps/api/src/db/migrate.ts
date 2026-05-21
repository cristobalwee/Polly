import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

/**
 * Apply every pending SQL migration in `./drizzle`, then exit.
 * Run via `pnpm --filter api db:migrate` (which loads `.env`).
 */
async function main() {
  console.log('▶ applying migrations…');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✓ migrations applied');
  await pool.end();
}

main().catch((err) => {
  console.error('✗ migration failed:', err);
  process.exit(1);
});
