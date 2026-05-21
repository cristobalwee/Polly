import {
  CreateKalshiCredentialSchema,
  type KalshiCredentialMetadata,
  type KalshiCredentialResponse,
  type KalshiEnvironment,
  type ValidationStatus,
} from '@polly/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { envelope } from '../crypto/secrets';
import { db } from '../db/client';
import { userKalshiCredentials, type UserKalshiCredentialRow } from '../db/schema';
import { validateKalshiCredentials } from '../kalshi/client';
import { requireAuth, type AuthVariables } from '../middleware/auth';

/**
 * Kalshi credential management.
 *
 * Every route requires a valid session. The Kalshi private key is sealed with
 * envelope encryption on the way in and is *never* part of any response —
 * `GET` returns metadata only, and `validate` decrypts the key transiently to
 * make one Kalshi call without ever serialising it.
 */
export const credentialsRoute = new Hono<{ Variables: AuthVariables }>();

credentialsRoute.use('*', requireAuth);

/** Project a DB row down to the safe, client-facing metadata shape. */
function toMetadata(row: UserKalshiCredentialRow): KalshiCredentialMetadata {
  return {
    keyId: row.keyId,
    environment: row.environment as KalshiEnvironment,
    validationStatus: row.validationStatus as ValidationStatus,
    lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load the calling user's single Kalshi credential row, if any. */
async function findCredential(userId: string): Promise<UserKalshiCredentialRow | undefined> {
  const rows = await db
    .select()
    .from(userKalshiCredentials)
    .where(eq(userKalshiCredentials.userId, userId))
    .limit(1);
  return rows[0];
}

/**
 * POST /credentials/kalshi — store (or replace) the user's Kalshi credential.
 * The private key is sealed before it touches the database. Replacing a key
 * resets validation state to `unvalidated`.
 */
credentialsRoute.post('/kalshi', async (c) => {
  const { id: userId } = c.get('user');

  const parsed = CreateKalshiCredentialSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid request', issues: parsed.error.flatten() }, 400);
  }
  const { keyId, privateKey, environment } = parsed.data;

  const sealed = envelope.seal(privateKey);

  const [row] = await db
    .insert(userKalshiCredentials)
    .values({
      userId,
      keyId,
      environment,
      encryptedPrivateKey: sealed.ciphertext,
      encryptedDek: sealed.encryptedDek,
      iv: sealed.iv,
      authTag: sealed.authTag,
      validationStatus: 'unvalidated',
      lastValidatedAt: null,
    })
    .onConflictDoUpdate({
      target: userKalshiCredentials.userId,
      set: {
        keyId,
        environment,
        encryptedPrivateKey: sealed.ciphertext,
        encryptedDek: sealed.encryptedDek,
        iv: sealed.iv,
        authTag: sealed.authTag,
        validationStatus: 'unvalidated',
        lastValidatedAt: null,
      },
    })
    .returning();

  const body: KalshiCredentialResponse = { credential: toMetadata(row) };
  return c.json(body, 201);
});

/**
 * GET /credentials/kalshi — metadata only. The private key never appears here.
 */
credentialsRoute.get('/kalshi', async (c) => {
  const { id: userId } = c.get('user');
  const row = await findCredential(userId);
  const body: KalshiCredentialResponse = {
    credential: row ? toMetadata(row) : null,
  };
  return c.json(body);
});

/**
 * DELETE /credentials/kalshi — remove the stored credential.
 */
credentialsRoute.delete('/kalshi', async (c) => {
  const { id: userId } = c.get('user');
  await db.delete(userKalshiCredentials).where(eq(userKalshiCredentials.userId, userId));
  return c.body(null, 204);
});

/**
 * POST /credentials/kalshi/validate — decrypt the key transiently, make one
 * authenticated Kalshi call, and persist the outcome.
 *
 *  - `valid` / `invalid` → `validation_status` + `last_validated_at` updated.
 *  - transport failure → 502, status left untouched (the key may still be fine).
 */
credentialsRoute.post('/kalshi/validate', async (c) => {
  const { id: userId } = c.get('user');

  const row = await findCredential(userId);
  if (!row) {
    return c.json({ error: 'No Kalshi credential to validate' }, 404);
  }

  // Decrypt only here, only in memory — the plaintext is never logged/returned.
  const privateKeyPem = envelope
    .open({
      ciphertext: row.encryptedPrivateKey,
      encryptedDek: row.encryptedDek,
      iv: row.iv,
      authTag: row.authTag,
    })
    .toString('utf8');

  const result = await validateKalshiCredentials({
    keyId: row.keyId,
    privateKeyPem,
    environment: row.environment as KalshiEnvironment,
  });

  if (result.outcome === 'error') {
    // Inconclusive — don't overwrite a previously-known status.
    return c.json({ error: result.reason }, 502);
  }

  const validationStatus: ValidationStatus =
    result.outcome === 'valid' ? 'valid' : 'invalid';

  const [updated] = await db
    .update(userKalshiCredentials)
    .set({ validationStatus, lastValidatedAt: new Date() })
    .where(eq(userKalshiCredentials.userId, userId))
    .returning();

  const body: KalshiCredentialResponse = { credential: toMetadata(updated) };
  return c.json(body);
});
