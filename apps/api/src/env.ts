import { z } from 'zod';

/**
 * Server environment, validated once at startup.
 *
 * Anything secret lives here and nowhere else — in particular the encryption
 * master key, which `crypto/envelope.ts` reads exclusively from `env`. If a
 * required variable is missing or malformed the process exits immediately with
 * a readable message rather than failing later, mid-request.
 */
const EnvSchema = z.object({
  /** Postgres connection string for Drizzle + node-postgres. */
  DATABASE_URL: z.string().url(),

  /** Better Auth signing secret — must be long enough to be unguessable. */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  /** Public base URL the auth handler is served from. */
  BETTER_AUTH_URL: z.string().url(),

  /**
   * Envelope-encryption master key: 32 bytes, hex-encoded (64 hex chars).
   * Used to wrap each per-credential data encryption key. Never logged.
   */
  ENCRYPTION_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_MASTER_KEY must be 64 hex chars (32 bytes)'),

  /** Origin of the Expo web build, allowed through CORS and trusted by auth. */
  WEB_ORIGIN: z.string().url().default('http://localhost:8081'),

  PORT: z.coerce.number().int().positive().default(3001),

  /**
   * Which Kalshi deployment the public market-data client and poller talk to.
   * `demo` by default — public endpoints need no credentials either way.
   */
  KALSHI_ENVIRONMENT: z.enum(['demo', 'production']).default('demo'),

  /**
   * Whether the `MarketsPoller` runs inside this process. On by default; set
   * to `false` for tests or one-off scripts that should not poll Kalshi.
   */
  MARKETS_POLLER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Whether the per-user `TradesPoller` runs inside this process. Only meaningful
   * when `MARKETS_POLLER_ENABLED=true` (the trades poller piggybacks on the
   * shared public client + shutdown handlers). On by default.
   */
  TRADES_POLLER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    console.error(`✗ Invalid environment configuration:\n${issues}`);
    console.error('  See apps/api/.env.example for the expected variables.');
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
