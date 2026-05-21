import { z } from 'zod';

/**
 * Contracts shared between the polly API and the polly clients.
 *
 * This package is consumed as raw TypeScript source (no build step): both the
 * Hono backend and the Expo app resolve `@polly/shared` straight to `src/`.
 */

/** Shape of `GET /health` — proves the client/server contract end to end. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  /** ISO-8601 timestamp, e.g. `2026-05-20T18:30:00.000Z`. */
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Kalshi credentials                                                         */
/* -------------------------------------------------------------------------- */

/** Which Kalshi deployment a key belongs to. */
export const KalshiEnvironmentSchema = z.enum(['demo', 'production']);
export type KalshiEnvironment = z.infer<typeof KalshiEnvironmentSchema>;

/**
 * Result of the most recent check against Kalshi's API.
 *  - `unvalidated` — stored but never tested.
 *  - `valid` — last test call authenticated successfully.
 *  - `invalid` — last test call was rejected (bad key / wrong environment).
 */
export const ValidationStatusSchema = z.enum(['unvalidated', 'valid', 'invalid']);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

/**
 * Body of `POST /credentials/kalshi`. The private key is a PEM-encoded RSA key
 * issued by Kalshi alongside the key id; it never leaves the server again.
 */
export const CreateKalshiCredentialSchema = z.object({
  keyId: z.string().min(1, 'Key id is required'),
  privateKey: z
    .string()
    .min(1, 'Private key is required')
    .refine((v) => v.includes('PRIVATE KEY'), {
      message: 'Expected a PEM-encoded private key (-----BEGIN PRIVATE KEY-----)',
    }),
  environment: KalshiEnvironmentSchema,
});
export type CreateKalshiCredential = z.infer<typeof CreateKalshiCredentialSchema>;

/**
 * Everything `GET /credentials/kalshi` is allowed to return — metadata only.
 * The private key and any derived secret are deliberately absent.
 */
export const KalshiCredentialMetadataSchema = z.object({
  keyId: z.string(),
  environment: KalshiEnvironmentSchema,
  validationStatus: ValidationStatusSchema,
  lastValidatedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type KalshiCredentialMetadata = z.infer<typeof KalshiCredentialMetadataSchema>;

/** `GET /credentials/kalshi` — `null` when the user has not connected Kalshi. */
export const KalshiCredentialResponseSchema = z.object({
  credential: KalshiCredentialMetadataSchema.nullable(),
});
export type KalshiCredentialResponse = z.infer<typeof KalshiCredentialResponseSchema>;
