import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ImplementationStatus } from '$features/implementation-status/domain/ImplementationStatus';
import type { Project } from './Project';

/**
 * Self-contained snapshot of an entire Project for export / share / backup.
 * Holds the project document plus every child Feature and every
 * implementation-status sidecar so an import on a fresh machine recreates
 * the project end-to-end. Time-travel history is intentionally NOT
 * included — it's a derived artifact, replaying it on a different machine
 * would break the original author/cursor invariants, and the
 * snapshot+spec is enough to reconstruct meaning.
 *
 * Carried as the plaintext inside the encrypted `.unspa` envelope below.
 */
export type ProjectBundleV1 = {
  readonly format: 'unspaghettit-project-bundle';
  readonly version: 1;
  readonly exportedAt: string;
  readonly project: Project;
  readonly features: readonly Feature[];
  readonly statuses: readonly ImplementationStatus[];
};

/**
 * Wire format for the `.unspa` file. Every field on the envelope is
 * a cryptographic necessity — salt + iv are public per-encryption
 * nonces, and algorithm + kdf + iterations + format + version are the
 * decryptor's instructions for reproducing the right key + recognising
 * a valid bundle before prompting for a passphrase. Nothing identifies
 * the *contents*: the project's name and every other piece of payload
 * data live ONLY inside the encrypted ciphertext, so an attacker
 * holding the file learns nothing about it without the passphrase.
 *
 * The plaintext (a JSON-encoded ProjectBundleV1) never leaves the
 * user's browser un-encrypted, even when bundling on a remote
 * dashboard, because encryption happens client-side with the user's
 * passphrase.
 */
export type EncryptedBundleEnvelope = {
  readonly format: 'unspaghettit-encrypted-bundle';
  readonly version: 1;
  readonly algorithm: 'AES-GCM';
  readonly kdf: 'PBKDF2-SHA256';
  readonly iterations: number;
  /** base64 of the 16-byte PBKDF2 salt. */
  readonly salt: string;
  /** base64 of the 12-byte AES-GCM iv. */
  readonly iv: string;
  /** base64 of the AES-GCM ciphertext (includes the 16-byte auth tag). */
  readonly ciphertext: string;
};
