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
  /** Current spec version: the ELEMENT's own stamp when it carries one, the
   *  owning feature's `updatedAt` otherwise. */
  readonly currentSpecVersion: string;
  /**
   * Which of those two answered. `element` means this exact entity changed after
   * the audit. `feature` means only the feature-wide stamp was available (a
   * snapshot written before per-element versions, or an element that has never
   * been stamped), so the entry is suspect by association, not by evidence.
   */
  readonly scope: 'element' | 'feature';
};

/** An index key that resolves to no spec entity — renamed or removed under it. */
export type OrphanEntry = {
  readonly key: string;
  readonly reason: string;
  /** For a `state:<path>` key whose path was renamed: the current key(s) to migrate it to. */
  readonly renamedTo?: readonly string[];
};

export type DriftReport = {
  /** Audited entries whose spec changed after they were last audited. */
  readonly stale: readonly DriftEntry[];
  /** Audited entries with no `auditedSpecVersion` — drift can't be judged, re-audit to stamp one. */
  readonly unversioned: readonly string[];
  /** Index keys that match no current spec entity. */
  readonly orphans: readonly OrphanEntry[];
  /** Number of resolvable, audited entries examined. */
  readonly checked: number;
  /**
   * Index keys skipped because a feature OUTSIDE the swept cohort owns them.
   * Only a sweep narrowed to part of a project can produce these: the key is
   * neither checked nor an orphan, it simply belongs to someone else. Always 0
   * for a whole-project sweep.
   */
  readonly outOfScope: number;
  /** Where the drift is, small enough to survive a capped or skimmed answer. */
  readonly summary: DriftSummary;
};

/** Stale counts only: `unversioned` and `orphans` are already flat, short lists. */
export type DriftSummary = {
  /** Stale entries per owning feature id. */
  readonly staleByFeature: Readonly<Record<string, number>>;
  /** Stale entries per evidence scope (see `DriftEntry.scope`). */
  readonly staleByScope: { readonly element: number; readonly feature: number };
};

/** Pure fold over the stale rows, shared by the detector and the report merge. */
export const summarizeStale = (stale: readonly DriftEntry[]): DriftSummary => {
  const staleByFeature: Record<string, number> = {};
  const staleByScope = { element: 0, feature: 0 };
  for (const entry of stale) {
    staleByFeature[entry.featureId] = (staleByFeature[entry.featureId] ?? 0) + 1;
    staleByScope[entry.scope] += 1;
  }
  return { staleByFeature, staleByScope };
};
