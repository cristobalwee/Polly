import { defineConfig } from 'vitest/config';

/**
 * Vitest config.
 *
 * `setupFiles` runs before any test module is imported, which is essential —
 * `src/env.ts` validates `process.env` *at import time* and exits on missing
 * vars, so the test harness needs to populate them up-front (especially the
 * `DATABASE_URL`, which we point at `polly_test` to keep dev data untouched).
 */
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    // The poller test runs the real Postgres against the test database; serial
    // execution avoids two suites stamping on each other's `markets` table.
    sequence: { concurrent: false },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
