import { expo } from '@better-auth/expo';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { db } from './db/client';
import { account, session, user, verification } from './db/schema';
import { env } from './env';

/**
 * argon2id parameters. argon2id is the OWASP-recommended password hash; we set
 * the algorithm (and cost parameters) explicitly rather than inheriting a
 * library default so the security posture is visible and reviewable here.
 */
const ARGON2_OPTIONS = {
  // `@node-rs/argon2` exposes `Algorithm` as an ambient const enum, which the
  // monorepo's `isolatedModules` setting forbids importing. `2` is its
  // `Algorithm.Argon2id` member — the only variant we want.
  algorithm: 2,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Better Auth instance — the single source of truth for sessions and users.
 *
 *  - **Provider:** email + password only for v0 (no social OAuth yet).
 *  - **Hashing:** argon2id via `@node-rs/argon2`, configured explicitly below.
 *  - **Sessions:** 30-day expiry, refreshed at most once a day.
 *  - **Storage:** its own `user` / `session` / `account` / `verification`
 *    tables through the Drizzle adapter (see `db/auth-schema.ts`).
 *  - **Clients:** httpOnly cookies for the web build; the `expo()` plugin lets
 *    the native client persist the session token in Expo SecureStore. `bearer()`
 *    additionally accepts `Authorization: Bearer <token>`.
 *
 * Cookies are marked `secure` automatically when `BETTER_AUTH_URL` is https,
 * so production gets secure cookies while local http dev still works.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    password: {
      hash: (password) => hash(password, ARGON2_OPTIONS),
      verify: ({ hash: storedHash, password }) => verify(storedHash, password, ARGON2_OPTIONS),
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // slide the expiry at most once per day
  },

  // The Expo web origin and the native deep-link scheme are allowed to drive
  // auth flows; everything else is rejected.
  trustedOrigins: [env.WEB_ORIGIN, 'polly://'],

  plugins: [expo(), bearer()],
});

export type Auth = typeof auth;
