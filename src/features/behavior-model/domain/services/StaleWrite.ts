import type { Feature } from '$features/behavior-model/domain/entities/Feature';

/**
 * Optimistic concurrency for a write: did the feature move since the caller read it?
 *
 * Two agents edited one surface at the same time. One rewrote a scenario the
 * other had created minutes earlier, and neither was told: every write is a
 * load, a transform and a save of the whole feature, so the second save simply
 * won. A caller can now name the `updatedAt` it read, and a write whose feature
 * has a different one is refused before anything is applied.
 *
 * The refusal names WHAT moved, not only that something did. The per-element
 * stamps (see FeatureElementVersions) already know when each element last
 * changed, so the keys stamped after the caller's read are exactly what it has
 * to re-read before rebasing, instead of the whole feature.
 *
 * Pure. Opt-in: no expected stamp, no check.
 */
export type StaleWrite = {
  readonly expectedUpdatedAt: string;
  readonly currentUpdatedAt: string;
  /** Element keys (`action:<id>`, `scenario:<id>`, ...) stamped after the expected read, newest first. */
  readonly changedSince: readonly string[];
  /** How many elements moved in all; `changedSince` stops at {@link CHANGED_SINCE_LIMIT}. */
  readonly changedSinceTotal: number;
};

export const CHANGED_SINCE_LIMIT = 50;

/**
 * Two stamps name the same version when they are the same instant. Compared as
 * instants when both read as dates, so a host that reformats the stamp it was
 * given (dropped milliseconds, an offset instead of Z) is not refused for it;
 * compared as text otherwise, so an unreadable stamp never passes by accident.
 */
const sameVersion = (expected: string, current: string): boolean => {
  const a = Date.parse(expected);
  const b = Date.parse(current);
  return Number.isNaN(a) || Number.isNaN(b) ? expected === current : a === b;
};

/**
 * The conflict to answer, or null when the feature is the one the caller read.
 *
 * `changedSince` is empty for a snapshot that carries no element stamps yet, for
 * an expected stamp that does not read as a date, and when the feature is OLDER
 * than the caller's read (a restore): the write is refused all the same, since
 * what the caller read is not what it would overwrite. An element REMOVED since
 * the read holds no stamp any more and cannot be listed; the re-read shows it gone.
 */
export const detectStaleWrite = (
  feature: Pick<Feature, 'updatedAt' | 'elementVersions'>,
  expectedUpdatedAt: string
): StaleWrite | null => {
  const currentUpdatedAt = String(feature.updatedAt);
  if (sameVersion(expectedUpdatedAt, currentUpdatedAt)) return null;

  const expected = Date.parse(expectedUpdatedAt);
  const moved = Object.entries(feature.elementVersions ?? {})
    .map(([key, stamp]) => ({ key, at: Date.parse(stamp) }))
    .filter(({ at }) => at > expected)
    // Newest first, so the cap keeps what moved last. The sort is stable: within
    // one write, keys stay in the order the feature lists them.
    .sort((a, b) => b.at - a.at);

  return {
    expectedUpdatedAt,
    currentUpdatedAt,
    changedSince: moved.slice(0, CHANGED_SINCE_LIMIT).map(({ key }) => key),
    changedSinceTotal: moved.length
  };
};

/** The one sentence a refused caller reads: what happened, and what to do next. */
export const staleWriteMessage = (conflict: StaleWrite): string =>
  `The feature changed since it was read (expected updatedAt ${conflict.expectedUpdatedAt}, current ${conflict.currentUpdatedAt}), so nothing was applied: re-read the elements named in changedSince, rebase the operations on what they are now, and send the batch again with expectedUpdatedAt ${conflict.currentUpdatedAt}.`;
