/**
 * What makes a string safe to use as ONE on-disk path component.
 *
 * Pure rule, no IO — which is why it lives in the domain rather than beside the
 * path builders that consume it. An application use-case validating an imported
 * bundle needs this answer before anything touches a disk, and reaching into
 * `shared/infrastructure/persistence` for it dragged `node:fs` into the
 * application layer's import graph to ask a question about a regex.
 *
 * The path builders re-export both, so every writer still enforces the same
 * rule from one definition.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const MAX_SEGMENT_LEN = 128;

export class UnsafePathSegmentError extends Error {
  constructor(
    readonly segment: string,
    readonly label: string
  ) {
    super(`Unsafe ${label}: "${segment}" is not a valid path-safe identifier`);
    this.name = 'UnsafePathSegmentError';
  }
}

/** True when a value is safe to use as a single on-disk path component. */
export const isSafeSegment = (segment: unknown): segment is string =>
  typeof segment === 'string' &&
  segment.length > 0 &&
  segment.length <= MAX_SEGMENT_LEN &&
  SAFE_SEGMENT.test(segment);

/** Assert-and-return guard for a dynamic path component. Throws on traversal. */
export const assertSafeSegment = (segment: string, label = 'path segment'): string => {
  if (!isSafeSegment(segment)) throw new UnsafePathSegmentError(String(segment), label);
  return segment;
};
