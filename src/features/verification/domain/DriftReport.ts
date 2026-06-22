import type { IndexedImplementationStatus } from './IndexedImplementation';

/**
 * One audited implementation whose owning feature has changed since the audit:
 * the code was mapped against an older version of the spec, so it may no longer
 * do what the spec now says. This is the spec→code half of drift (the code→spec
 * half — moved/deleted source lines — is handled at the index-write edge).
 */
export type DriftEntry = {
  readonly key: string;
  /** The id/path/name after the `<type>:` prefix. */
  readonly entitySuffix: string;
  readonly featureId: string;
  readonly featureName: string;
  readonly status: IndexedImplementationStatus;
  /** Spec version the code was audited against. */
  readonly auditedSpecVersion: string;
  /** Current spec version (the owning feature's `updatedAt`). */
  readonly currentSpecVersion: string;
};

/** An index key that resolves to no spec entity — renamed or removed under it. */
export type OrphanEntry = {
  readonly key: string;
  readonly reason: string;
};

export type DriftReport = {
  /** Audited entries whose feature changed after they were last audited. */
  readonly stale: readonly DriftEntry[];
  /** Audited entries with no `auditedSpecVersion` — drift can't be judged, re-audit to stamp one. */
  readonly unversioned: readonly string[];
  /** Index keys that match no current spec entity. */
  readonly orphans: readonly OrphanEntry[];
  /** Number of resolvable, audited entries examined. */
  readonly checked: number;
};
