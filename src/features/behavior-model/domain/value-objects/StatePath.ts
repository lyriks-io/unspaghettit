import type { Brand } from '$shared/domain/Brand';
import type { StateValue } from './StateValue';

export type StatePath = Brand<string, 'StatePath'>;

const STATE_PATH_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

export const isStatePath = (v: string): v is StatePath => STATE_PATH_PATTERN.test(v);

export const asStatePath = (v: string): StatePath => {
  if (!isStatePath(v)) {
    throw new Error(`Invalid state path: ${JSON.stringify(v)}`);
  }
  return v as StatePath;
};

export const splitPath = (path: StatePath): readonly string[] => path.split('.');

export type StateSnapshot = { readonly [key: string]: StateValue };

export const readPath = (snapshot: StateSnapshot, path: StatePath): StateValue | undefined => {
  const segments = splitPath(path);
  let cursor: StateValue | undefined = snapshot;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as { [k: string]: StateValue })[segment];
  }
  return cursor;
};

/**
 * Rewrite any top-level keys that contain dots into the nested representation
 * via `writePath`, so a snapshot authored as `{ "cart.subtotalCents": 1000 }`
 * lines up with the rest of the engine (which reads nested via `readPath`).
 *
 * Both shapes flow through public surfaces:
 *   - Scenario overrides land via `writePath` already (correctly nested).
 *   - `dry_run_simulate` callers pass JSON snapshots straight from the wire;
 *     dotted top-level keys are a natural authoring shortcut that used to
 *     silently fail because `readPath("cart.subtotalCents", snapshot)` looks
 *     for `snapshot.cart.subtotalCents`, not the literal string key.
 *
 * Idempotent: snapshots with no dotted top-level keys are returned unchanged.
 */
export const normalizeSnapshot = (snapshot: StateSnapshot): StateSnapshot => {
  const flatKeys = Object.keys(snapshot).filter((k) => k.includes('.'));
  if (flatKeys.length === 0) return snapshot;
  let next: StateSnapshot = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (key.includes('.')) {
      if (isStatePath(key)) {
        next = writePath(next, key as StatePath, value);
      }
      // else: dotted but not a valid state path. Drop it; the engine
      // wouldn't have read it anyway.
    } else {
      next = { ...next, [key]: value };
    }
  }
  return next;
};

export const writePath = (
  snapshot: StateSnapshot,
  path: StatePath,
  value: StateValue
): StateSnapshot => {
  const segments = splitPath(path);
  if (segments.length === 0) return snapshot;

  const cloneObj = (s: StateSnapshot): { [k: string]: StateValue } => ({ ...s });

  const next = cloneObj(snapshot);
  let cursor: { [k: string]: StateValue } = next;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] as string;
    const existing = cursor[segment];
    const child =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? cloneObj(existing as StateSnapshot)
        : {};
    cursor[segment] = child;
    cursor = child;
  }
  const lastSegment = segments[segments.length - 1] as string;
  cursor[lastSegment] = value;
  return next;
};
