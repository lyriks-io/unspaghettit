import type { ProjectId } from '$features/projects/domain/value-objects/ids';
import type {
  EncryptedBundleEnvelope,
  ProjectBundleV1
} from '$features/projects/domain/entities/ProjectBundle';
import {
  encryptBundle,
  decryptBundle,
  MalformedEnvelopeError,
  WeakPassphraseError,
  WrongPassphraseError
} from '$features/projects/infrastructure/io/bundleCrypto';
import { apiFetch } from '$shared/security/apiFetch';

/**
 * Client-side orchestration for the `.unspa` export / import flows. All
 * encryption happens in the browser via WebCrypto; the passphrase never
 * touches the server. The dashboard's REST endpoints only see plaintext
 * bundles (project + features + statuses) — they never see the
 * passphrase, and never store the encrypted file.
 *
 * Surface:
 *   - exportProjectBundle(...) → returns the EncryptedBundleEnvelope.
 *     Caller decides how to deliver it (download, copy, share).
 *   - downloadEnvelopeAs(...) → utility to trigger a browser download
 *     with the `.unspa` extension.
 *   - importEnvelope(...) → decrypts + POSTs to /api/projects/import.
 *     Returns the server's restore summary.
 *
 * Errors surface as typed exceptions so the UI can render focused
 * messages (wrong passphrase vs malformed file vs network).
 */

export { WeakPassphraseError, WrongPassphraseError, MalformedEnvelopeError };

const slugify = (s: string): string => {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'project';
};

/**
 * Fetch the plaintext bundle for `projectId`, encrypt with `passphrase`,
 * and return both the envelope and the project name (the latter so the
 * caller can build a sensible download filename WITHOUT leaking the
 * name in the envelope itself). The bundle is built server-side
 * (already gathers the project's features + statuses); we just encrypt
 * locally.
 */
export const exportProjectBundle = async (
  projectId: ProjectId,
  passphrase: string
): Promise<{ envelope: EncryptedBundleEnvelope; projectName: string }> => {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(String(projectId))}/bundle`);
  if (!res.ok) {
    throw new Error(`Bundle fetch failed (${res.status}): ${await res.text().catch(() => '')}`);
  }
  const bundle = (await res.json()) as ProjectBundleV1;
  const plaintext = JSON.stringify(bundle);
  const envelope = await encryptBundle(plaintext, passphrase);
  return { envelope, projectName: bundle.project.name };
};

/**
 * Trigger a browser download of the envelope. The filename is derived
 * from the caller-supplied `projectName` (held in memory only, never
 * stored in the file itself). Users can override via the browser's
 * save dialog.
 */
export const downloadEnvelopeAs = (
  envelope: EncryptedBundleEnvelope,
  projectName: string
): void => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `${slugify(projectName)}-${today}.unspa`;
  const blob = new Blob([JSON.stringify(envelope, null, 2)], {
    type: 'application/octet-stream'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Read a File picked by the user as a JSON envelope. Throws
 * MalformedEnvelopeError when the file isn't a valid `.unspa` JSON
 * object — saves the caller from having to differentiate IO failures
 * from format failures.
 */
export const readEnvelopeFromFile = async (
  file: File
): Promise<EncryptedBundleEnvelope> => {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new MalformedEnvelopeError(`could not read ${file.name}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MalformedEnvelopeError('file is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new MalformedEnvelopeError('file is not a JSON object');
  }
  return parsed as EncryptedBundleEnvelope;
};

/**
 * Decrypt + POST to the restore endpoint. Returns the server's summary
 * ({projectId, featuresImported, statusesImported}) on success.
 *
 * The decrypt step is where a bad passphrase manifests; WrongPassphraseError
 * lets the UI prompt for a re-try without confusing the user with the
 * platform's opaque OperationError.
 */
export const importEnvelope = async (
  envelope: EncryptedBundleEnvelope,
  passphrase: string
): Promise<{ projectId: string; featuresImported: number; statusesImported: number }> => {
  const plaintext = await decryptBundle(envelope, passphrase);
  let bundle: ProjectBundleV1;
  try {
    bundle = JSON.parse(plaintext) as ProjectBundleV1;
  } catch {
    throw new MalformedEnvelopeError('decrypted payload is not valid JSON');
  }
  const res = await apiFetch('/api/projects/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle)
  });
  if (!res.ok) {
    throw new Error(`Import failed (${res.status}): ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as {
    projectId: string;
    featuresImported: number;
    statusesImported: number;
  };
};
