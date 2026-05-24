import type { EncryptedBundleEnvelope } from '$features/projects/domain/entities/ProjectBundle';

/**
 * Client-side encryption for .unspa bundles. Uses the platform-native
 * WebCrypto subtle API (no third-party crypto deps, fully audited stack).
 *
 *   - PBKDF2-SHA256 with 600 000 iterations derives a 256-bit AES key
 *     from the passphrase + a fresh per-export 16-byte salt. OWASP's
 *     2023 minimum recommendation for PBKDF2-SHA256 is 600k.
 *   - AES-GCM-256 encrypts the JSON-encoded plaintext under a fresh
 *     12-byte IV. The 128-bit auth tag is appended to the ciphertext by
 *     the spec, so a tampered file (or a wrong passphrase) fails at
 *     `subtle.decrypt` instead of returning gibberish.
 *
 * The passphrase never leaves the browser. The dashboard server stores
 * the project / features as ordinary JSON on disk; encryption only
 * applies to the share/backup file the user downloads.
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const subtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'WebCrypto not available. Use a modern browser served over https or localhost.'
    );
  }
  return crypto.subtle;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (s: string): Uint8Array => {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

const deriveKey = async (passphrase: string, salt: Uint8Array): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  const baseKey = await subtle().importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export class WeakPassphraseError extends Error {
  constructor() {
    super('Passphrase must be at least 8 characters.');
    this.name = 'WeakPassphraseError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase, or the .unspa file is corrupted.');
    this.name = 'WrongPassphraseError';
  }
}

export class MalformedEnvelopeError extends Error {
  constructor(reason: string) {
    super(`Not a valid Unspaghettit bundle: ${reason}`);
    this.name = 'MalformedEnvelopeError';
  }
}

/**
 * Encrypt a JSON string into an .unspa envelope. Generates a fresh salt
 * and iv every call, so the same plaintext + passphrase produces a
 * different envelope every time (anti-replay friendly + harmless). The
 * envelope deliberately carries NO identifier of the contents — a third
 * party seeing the file learns only that it's an Unspaghettit bundle
 * with these crypto parameters, never which project it is. The project
 * name lives ONLY inside the ciphertext.
 */
export const encryptBundle = async (
  plaintext: string,
  passphrase: string
): Promise<EncryptedBundleEnvelope> => {
  if (passphrase.length < 8) throw new WeakPassphraseError();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    format: 'unspaghettit-encrypted-bundle',
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext))
  };
};

const validateEnvelope = (raw: unknown): EncryptedBundleEnvelope => {
  if (!raw || typeof raw !== 'object') throw new MalformedEnvelopeError('not an object');
  const o = raw as Partial<EncryptedBundleEnvelope>;
  if (o.format !== 'unspaghettit-encrypted-bundle') {
    throw new MalformedEnvelopeError('wrong format tag');
  }
  if (o.version !== 1) throw new MalformedEnvelopeError(`unsupported version ${o.version}`);
  if (o.algorithm !== 'AES-GCM') throw new MalformedEnvelopeError(`unsupported algorithm ${o.algorithm}`);
  if (o.kdf !== 'PBKDF2-SHA256') throw new MalformedEnvelopeError(`unsupported kdf ${o.kdf}`);
  if (typeof o.iterations !== 'number' || o.iterations < 100_000) {
    throw new MalformedEnvelopeError('iterations missing or too low');
  }
  if (typeof o.salt !== 'string' || typeof o.iv !== 'string' || typeof o.ciphertext !== 'string') {
    throw new MalformedEnvelopeError('salt / iv / ciphertext must be base64 strings');
  }
  return o as EncryptedBundleEnvelope;
};

/**
 * Decrypt an .unspa envelope back to a JSON string. Throws
 * WrongPassphraseError on bad passphrase or tampered ciphertext (the
 * GCM auth tag check catches both), so the caller can show a focused
 * error message instead of leaking the platform's opaque
 * `OperationError`.
 */
export const decryptBundle = async (
  raw: unknown,
  passphrase: string
): Promise<string> => {
  const envelope = validateEnvelope(raw);
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  const key = await deriveKey(passphrase, salt);
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new WrongPassphraseError();
  }
};
