import { randomBytes } from 'node:crypto';

/**
 * Populate `process.env` before any source module loads.
 *
 * `src/env.ts` parses `process.env` at import time and exits on validation
 * failure — so the test harness MUST set every required variable before any
 * test module pulls in `./db/client`, `./auth`, etc. Anything genuinely
 * sensitive in production is replaced here with a random throwaway.
 */

process.env.DATABASE_URL ??= 'postgresql://cristobalgrana@localhost:5432/polly_test';
process.env.BETTER_AUTH_SECRET ??= randomBytes(32).toString('base64url');
process.env.BETTER_AUTH_URL ??= 'http://localhost:3001';
process.env.ENCRYPTION_MASTER_KEY ??= randomBytes(32).toString('hex');
process.env.WEB_ORIGIN ??= 'http://localhost:8081';
// Tests own each poller's lifecycle — never auto-start them.
process.env.MARKETS_POLLER_ENABLED = 'false';
process.env.TRADES_POLLER_ENABLED = 'false';
