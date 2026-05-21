import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from './schema';

/**
 * Shared Postgres connection pool and Drizzle client.
 *
 * Everything that touches the database — Better Auth's adapter, the credential
 * routes, the migration runner — goes through this single pool.
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
