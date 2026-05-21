import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

/**
 * Envelope encryption for at-rest secrets (Kalshi private keys).
 *
 * Two layers of AES-256-GCM:
 *
 *  1. The plaintext secret is encrypted under a fresh, random 32-byte **data
 *     encryption key (DEK)** generated per secret.
 *  2. That DEK is then encrypted under the long-lived **master key** held only
 *     in the server environment (`ENCRYPTION_MASTER_KEY`).
 *
 * Recovering the plaintext therefore requires *both* the master key and the
 * stored row — the master key alone decrypts nothing, and a stolen database
 * row is inert without the master key. Rotating the master key only re-wraps
 * DEKs; it never touches the (much larger) secret ciphertext.
 *
 * GCM gives us authenticated encryption: any tampering with a ciphertext, IV,
 * auth tag, or the wrapped DEK makes `open()` throw rather than return corrupt
 * plaintext.
 */

/** AES-256-GCM: 256-bit keys, 96-bit IVs, 128-bit auth tags. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * A sealed secret. The four fields map one-to-one onto the columns of
 * `user_kalshi_credentials`:
 *
 *  - `ciphertext`    → `encrypted_private_key`
 *  - `encryptedDek`  → `encrypted_dek`  (a self-framing `IV ‖ tag ‖ ciphertext` blob)
 *  - `iv`            → `iv`             (IV for the `ciphertext` above)
 *  - `authTag`       → `auth_tag`       (GCM tag for the `ciphertext` above)
 *
 * The wrapped-DEK layer carries its own IV and tag inside `encryptedDek`, so
 * the table needs only one `iv`/`auth_tag` pair.
 */
export type SealedSecret = {
  ciphertext: Buffer;
  encryptedDek: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

/** Decode a 32-byte master key from its 64-char hex representation. */
export function parseMasterKey(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Master key must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars), got ${key.length}`,
    );
  }
  return key;
}

/** Encrypt `plaintext` under `key` with a fresh IV; returns the GCM triple. */
function encryptGcm(
  key: Buffer,
  plaintext: Buffer,
): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

/** Decrypt a GCM triple; throws if the key, IV, tag, or ciphertext is wrong. */
function decryptGcm(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  ciphertext: Buffer,
): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * An envelope-encryption instance bound to one master key.
 *
 * Created via {@link createEnvelope}. Production code uses the default export
 * (`envelope`), bound to `ENCRYPTION_MASTER_KEY`; tests construct their own to
 * exercise wrong-key rejection.
 */
export type Envelope = {
  /** Encrypt a secret. Each call mints a new DEK and fresh IVs. */
  seal(plaintext: string | Buffer): SealedSecret;
  /** Decrypt a previously sealed secret. Throws on any tampering or wrong key. */
  open(sealed: SealedSecret): Buffer;
};

export function createEnvelope(masterKey: Buffer): Envelope {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(`Master key must be ${KEY_BYTES} bytes, got ${masterKey.length}`);
  }

  return {
    seal(plaintext) {
      const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;

      // Layer 1: encrypt the secret under a fresh per-secret DEK.
      const dek = randomBytes(KEY_BYTES);
      const inner = encryptGcm(dek, data);

      // Layer 2: wrap the DEK under the master key. Frame the wrapped DEK as
      // `IV ‖ tag ‖ ciphertext` so it round-trips through a single column.
      const wrapped = encryptGcm(masterKey, dek);
      const encryptedDek = Buffer.concat([wrapped.iv, wrapped.authTag, wrapped.ciphertext]);

      return {
        ciphertext: inner.ciphertext,
        encryptedDek,
        iv: inner.iv,
        authTag: inner.authTag,
      };
    },

    open(sealed) {
      const { encryptedDek } = sealed;
      if (encryptedDek.length < IV_BYTES + TAG_BYTES) {
        throw new Error('Malformed wrapped DEK: blob is too short');
      }

      // Unframe and unwrap the DEK.
      const dekIv = encryptedDek.subarray(0, IV_BYTES);
      const dekTag = encryptedDek.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const dekCiphertext = encryptedDek.subarray(IV_BYTES + TAG_BYTES);
      const dek = decryptGcm(masterKey, dekIv, dekTag, dekCiphertext);

      // Use the recovered DEK to decrypt the secret itself.
      return decryptGcm(dek, sealed.iv, sealed.authTag, sealed.ciphertext);
    },
  };
}

// Note: this module is intentionally free of any environment access, so the
// unit tests can import it without `ENCRYPTION_MASTER_KEY` being set. The
// process-wide instance bound to the real master key lives in `secrets.ts`.
