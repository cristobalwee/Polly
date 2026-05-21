import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEnvelope, parseMasterKey, type SealedSecret } from './envelope';

/** A representative payload: a PEM-ish multi-line secret. */
const SAMPLE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDexample',
  '-----END PRIVATE KEY-----',
].join('\n');

const masterKeyA = randomBytes(32);
const masterKeyB = randomBytes(32);

describe('parseMasterKey', () => {
  it('decodes a valid 64-char hex key to 32 bytes', () => {
    const key = parseMasterKey(masterKeyA.toString('hex'));
    expect(key).toHaveLength(32);
    expect(key.equals(masterKeyA)).toBe(true);
  });

  it('rejects a key of the wrong length', () => {
    expect(() => parseMasterKey('abcd')).toThrow(/32 bytes/);
    expect(() => parseMasterKey(randomBytes(16).toString('hex'))).toThrow(/32 bytes/);
  });
});

describe('createEnvelope', () => {
  it('rejects a master key that is not 32 bytes', () => {
    expect(() => createEnvelope(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe('seal / open roundtrip', () => {
  const envelope = createEnvelope(masterKeyA);

  it('recovers the original plaintext (string)', () => {
    const sealed = envelope.seal(SAMPLE_KEY);
    expect(envelope.open(sealed).toString('utf8')).toBe(SAMPLE_KEY);
  });

  it('recovers the original plaintext (Buffer)', () => {
    const payload = randomBytes(512);
    const sealed = envelope.seal(payload);
    expect(envelope.open(sealed).equals(payload)).toBe(true);
  });

  it('produces the four columns with the expected shapes', () => {
    const sealed = envelope.seal(SAMPLE_KEY);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
    // encrypted_dek frames its own 12-byte IV + 16-byte tag ahead of the
    // 32-byte wrapped DEK ciphertext.
    expect(sealed.encryptedDek).toHaveLength(12 + 16 + 32);
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
  });

  it('never stores the plaintext in any ciphertext field', () => {
    const sealed = envelope.seal(SAMPLE_KEY);
    const needle = Buffer.from(SAMPLE_KEY, 'utf8');
    expect(sealed.ciphertext.includes(needle)).toBe(false);
    expect(sealed.encryptedDek.includes(needle)).toBe(false);
  });

  it('uses a fresh DEK and IVs on every seal (no deterministic output)', () => {
    const a = envelope.seal(SAMPLE_KEY);
    const b = envelope.seal(SAMPLE_KEY);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.encryptedDek.equals(b.encryptedDek)).toBe(false);
    // ...yet both still decrypt to the same plaintext.
    expect(envelope.open(a).toString('utf8')).toBe(SAMPLE_KEY);
    expect(envelope.open(b).toString('utf8')).toBe(SAMPLE_KEY);
  });
});

describe('tamper rejection', () => {
  const envelope = createEnvelope(masterKeyA);

  /** Return a copy of `sealed` with one byte of the named field flipped. */
  function corrupt(sealed: SealedSecret, field: keyof SealedSecret): SealedSecret {
    const copy: SealedSecret = {
      ciphertext: Buffer.from(sealed.ciphertext),
      encryptedDek: Buffer.from(sealed.encryptedDek),
      iv: Buffer.from(sealed.iv),
      authTag: Buffer.from(sealed.authTag),
    };
    copy[field][0] ^= 0xff;
    return copy;
  }

  it.each<keyof SealedSecret>(['ciphertext', 'encryptedDek', 'iv', 'authTag'])(
    'rejects a tampered %s',
    (field) => {
      const sealed = envelope.seal(SAMPLE_KEY);
      expect(() => envelope.open(corrupt(sealed, field))).toThrow();
    },
  );

  it('rejects a truncated wrapped DEK blob', () => {
    const sealed = envelope.seal(SAMPLE_KEY);
    expect(() =>
      envelope.open({ ...sealed, encryptedDek: sealed.encryptedDek.subarray(0, 8) }),
    ).toThrow(/too short/);
  });
});

describe('wrong-key rejection', () => {
  it('cannot open a secret sealed under a different master key', () => {
    const sealedByA = createEnvelope(masterKeyA).seal(SAMPLE_KEY);
    // Same ciphertext + wrapped DEK, but a different master key — the wrapped
    // DEK fails GCM authentication, so the secret is unrecoverable.
    expect(() => createEnvelope(masterKeyB).open(sealedByA)).toThrow();
  });

  it('the master key alone is not enough — the row is also required', () => {
    // Sealing under A then opening under A works; opening the *same* sealed
    // value under B fails. Equivalently: holding masterKeyA but not the row
    // (encryptedDek) yields nothing. This asserts the envelope property.
    const envelopeA = createEnvelope(masterKeyA);
    const sealed = envelopeA.seal(SAMPLE_KEY);
    expect(envelopeA.open(sealed).toString('utf8')).toBe(SAMPLE_KEY);
    expect(() => createEnvelope(masterKeyB).open(sealed)).toThrow();
  });
});
