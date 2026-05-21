import { constants, sign } from 'node:crypto';
import type { KalshiEnvironment } from '@polly/shared';

/**
 * Minimal Kalshi API client — just enough to prove a stored credential works.
 *
 * Kalshi authenticates requests with an RSA key pair: the caller signs
 * `timestamp + method + path` with their private key (RSA-PSS / SHA-256) and
 * sends the signature, their key id, and the timestamp as headers. This module
 * builds that signature and makes one trivial authenticated call so the API can
 * record whether a credential is `valid` or `invalid`.
 */

const BASE_URLS: Record<KalshiEnvironment, string> = {
  demo: 'https://demo-api.kalshi.co/trade-api/v2',
  production: 'https://api.elections.kalshi.com/trade-api/v2',
};

/** Path used for the validation probe — a trivial authenticated GET. */
const PROBE_PATH = '/portfolio/balance';

export type KalshiValidationResult =
  /** The credential authenticated successfully. */
  | { outcome: 'valid' }
  /** Kalshi rejected the credential (bad key, wrong environment, …). */
  | { outcome: 'invalid'; reason: string }
  /** The check could not be completed (network/transport failure). */
  | { outcome: 'error'; reason: string };

/**
 * Sign `timestamp + method + path` with the user's RSA private key.
 * Throws if the PEM is malformed or not an RSA key.
 */
function signRequest(
  privateKeyPem: string,
  timestamp: string,
  method: string,
  path: string,
): string {
  const message = `${timestamp}${method}${path}`;
  return sign('sha256', Buffer.from(message), {
    key: privateKeyPem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

/**
 * Make one authenticated request to Kalshi and report whether the credential
 * is usable. Never throws — transport problems come back as `outcome: 'error'`
 * so the caller can distinguish "key is bad" from "Kalshi was unreachable".
 *
 * The private key is used here and discarded; it is never logged or returned.
 */
export async function validateKalshiCredentials(args: {
  keyId: string;
  privateKeyPem: string;
  environment: KalshiEnvironment;
}): Promise<KalshiValidationResult> {
  const { keyId, privateKeyPem, environment } = args;
  const timestamp = Date.now().toString();
  const method = 'GET';

  // The signed path must include the `/trade-api/v2` prefix.
  const signedPath = `/trade-api/v2${PROBE_PATH}`;

  let signature: string;
  try {
    signature = signRequest(privateKeyPem, timestamp, method, signedPath);
  } catch {
    // A malformed or non-RSA private key can never authenticate.
    return { outcome: 'invalid', reason: 'Private key is not a usable RSA key' };
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URLS[environment]}${PROBE_PATH}`, {
      method,
      headers: {
        'KALSHI-ACCESS-KEY': keyId,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network error';
    return { outcome: 'error', reason: `Could not reach Kalshi: ${reason}` };
  }

  if (res.ok) {
    return { outcome: 'valid' };
  }
  if (res.status === 401 || res.status === 403) {
    return { outcome: 'invalid', reason: `Kalshi rejected the credential (HTTP ${res.status})` };
  }
  return { outcome: 'error', reason: `Unexpected Kalshi response (HTTP ${res.status})` };
}
