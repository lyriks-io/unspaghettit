/**
 * Structured "what changed in this write" descriptor produced by diffing
 * two snapshots. Drives both the activity toast (path-based breadcrumb +
 * op chip) and the per-feature history label, so the two channels stay
 * consistent and we only diff once per write.
 *
 *   prev: the in-memory snapshot before the write landed (null on first
 *         creation; the helper degrades to "saved").
 *   next: the snapshot after the write.
 *
 * Detection order matters: a single write can change many fields, we pick
 * the most user-visible delta first (rename > add/remove > description >
 * generic saved). When nothing concrete is identifiable we fall back to
 * { op: 'saved', path: [next.name] } so the consumer always has at least
 * the entity name to anchor on.
 *
 * Pure, shape-agnostic. Operates on plain JSON-shaped data (the snapshots
 * Yjs stores are POJOs, not class instances), so no runtime imports of
 * Feature / Project types — keeps this file zero-dependency and easy to
 * test or reuse from any sync surface.
 */

type AnyObj = Record<string, unknown>;

export type ChangeOp =
  | 'added'
  | 'removed'
  | 'renamed'
  | 'edited'
  | 'queued'
  | 'unqueued'
  | 'saved'
  | 'deleted'
  | 'created';

export type ChangeDescriptor = {
  readonly op: ChangeOp;
  /**
   * Human-readable breadcrumb from the entity root inward to the leaf
   * that changed. e.g. ["Inbox v2", "Inbox List", "Archive Item"] when an
   * Action was added on the Inbox List surface of the Inbox v2 feature.
   * Always at least one element (the entity name itself).
   */
  readonly path: readonly string[];
  /**
   * Optional extra clarifier. For renames, the previous name. For other
   * ops the descriptor is self-explanatory from `path` + `op`.
   */
  readonly previousName?: string;
};

const asObj = (v: unknown): AnyObj | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyObj) : null;

const asArr = (v: unknown): readonly unknown[] | null =>
  Array.isArray(v) ? v : null;

const nameOf = (v: unknown, fallback = 'untitled'): string => {
  const o = asObj(v);
  if (!o) return fallback;
  if (typeof o.name === 'string' && o.name.length > 0) return o.name;
  return fallback;
};

const idOf = (v: unknown): string | null => {
  const o = asObj(v);
  if (!o) return null;
  if (typeof o.id === 'string') return o.id;
  return null;
};

const indexById = (items: readonly unknown[]): Map<string, AnyObj> => {
  const out = new Map<string, AnyObj>();
  for (const item of items) {
    const id = idOf(item);
    const obj = asObj(item);
    if (id !== null && obj) out.set(id, obj);
  }
  return out;
};

/**
 * Compare two arrays-of-{id,name} children and pull the first concrete
 * change. Returns null when membership is identical and no member's name
 * changed; callers then fall through to deeper checks.
 *
 *   pathPrefix: names from the entity root down to the parent of `next`.
 *   leafLabel:  what to call a member when no `name` exists (e.g. "rule").
 */
const diffNamedChildren = (
  prev: readonly unknown[],
  next: readonly unknown[],
  pathPrefix: readonly string[],
  leafLabel: string
): ChangeDescriptor | null => {
  const prevMap = indexById(prev);
  const nextMap = indexById(next);

  // Additions first (most common via MCP). One per write is the common
  // case, so the first added we find wins.
  for (const item of next) {
    const id = idOf(item);
    if (id === null) continue;
    if (!prevMap.has(id)) {
      return {
        op: 'added',
        path: [...pathPrefix, nameOf(item, leafLabel)]
      };
    }
  }
  for (const item of prev) {
    const id = idOf(item);
    if (id === null) continue;
    if (!nextMap.has(id)) {
      return {
        op: 'removed',
        path: [...pathPrefix, nameOf(item, leafLabel)]
      };
    }
  }
  // Renames in-place.
  for (const [id, nextItem] of nextMap) {
    const prevItem = prevMap.get(id);
    if (!prevItem) continue;
    const prevName = typeof prevItem.name === 'string' ? prevItem.name : null;
    const nextName = typeof nextItem.name === 'string' ? nextItem.name : null;
    if (prevName !== null && nextName !== null && prevName !== nextName) {
      return {
        op: 'renamed',
        path: [...pathPrefix, nextName],
        previousName: prevName
      };
    }
  }
  return null;
};

/**
 * Count delta on a child collection where elements may not carry a name
 * (rules, effects, invariants, transitions, parameters, state defs).
 * Returns a path like [..., "rule"] / [..., "effect"] etc.
 */
const diffCountedChildren = (
  prev: readonly unknown[],
  next: readonly unknown[],
  pathPrefix: readonly string[],
  leafLabel: string
): ChangeDescriptor | null => {
  const delta = next.length - prev.length;
  if (delta === 0) return null;
  return {
    op: delta > 0 ? 'added' : 'removed',
    path: [...pathPrefix, leafLabel]
  };
};

/**
 * Walk a Feature snapshot. Picks the first concrete change going
 * top-down: feature name → feature description → top-level collections
 * → per-surface metadata → per-surface collections → per-action metadata
 * → per-action collections.
 */
const diffFeatureSnapshot = (
  prev: AnyObj,
  next: AnyObj
): ChangeDescriptor | null => {
  const featureName = nameOf(next, 'feature');

  if (
    typeof prev.name === 'string' &&
    typeof next.name === 'string' &&
    prev.name !== next.name
  ) {
    return {
      op: 'renamed',
      path: [next.name],
      previousName: prev.name
    };
  }

  // Surfaces (top-level): membership and per-surface rename.
  const prevSurfaces = asArr(prev.surfaces) ?? [];
  const nextSurfaces = asArr(next.surfaces) ?? [];
  const surfaceChange = diffNamedChildren(
    prevSurfaces,
    nextSurfaces,
    [featureName],
    'surface'
  );
  if (surfaceChange) return surfaceChange;

  // Walk into surfaces by id for deeper changes.
  const prevSurfaceMap = indexById(prevSurfaces);
  for (const nextSurface of nextSurfaces) {
    const sid = idOf(nextSurface);
    if (sid === null) continue;
    const prevSurface = prevSurfaceMap.get(sid);
    if (!prevSurface) continue;
    const surfaceName = nameOf(nextSurface, 'surface');
    const surfacePath = [featureName, surfaceName];

    if (
      typeof prevSurface.description === 'string' &&
      typeof (nextSurface as AnyObj).description === 'string' &&
      prevSurface.description !== (nextSurface as AnyObj).description
    ) {
      // Surface description tweak — handled later in fall-through to
      // avoid stealing the spotlight from concrete add/remove deltas.
    }

    // Actions on this surface (named children, primary hot path).
    const prevActions = asArr(prevSurface.actions) ?? [];
    const nextActions = asArr((nextSurface as AnyObj).actions) ?? [];
    const actionChange = diffNamedChildren(
      prevActions,
      nextActions,
      surfacePath,
      'action'
    );
    if (actionChange) return actionChange;

    // Per-action deep diffs.
    const prevActionMap = indexById(prevActions);
    for (const nextAction of nextActions) {
      const aid = idOf(nextAction);
      if (aid === null) continue;
      const prevAction = prevActionMap.get(aid);
      if (!prevAction) continue;
      const actionName = nameOf(nextAction, 'action');
      const actionPath = [...surfacePath, actionName];

      if (
        typeof prevAction.intent === 'string' &&
        typeof (nextAction as AnyObj).intent === 'string' &&
        prevAction.intent !== (nextAction as AnyObj).intent
      ) {
        return { op: 'edited', path: [...actionPath, 'intent'] };
      }

      for (const [field, label] of [
        ['parameters', 'parameter'],
        ['rules', 'rule'],
        ['effects', 'effect'],
        ['invariants', 'invariant']
      ] as const) {
        const change = diffCountedChildren(
          asArr(prevAction[field]) ?? [],
          asArr((nextAction as AnyObj)[field]) ?? [],
          actionPath,
          label
        );
        if (change) return change;
      }
    }

    // Surface-scoped collections (no per-child names → counted).
    for (const [field, label] of [
      ['stateDefinitions', 'state'],
      ['rules', 'surface rule'],
      ['invariants', 'surface invariant'],
      ['transitions', 'transition']
    ] as const) {
      const change = diffCountedChildren(
        asArr(prevSurface[field]) ?? [],
        asArr((nextSurface as AnyObj)[field]) ?? [],
        surfacePath,
        label
      );
      if (change) return change;
    }
  }

  // Top-level feature collections.
  for (const [field, label] of [
    ['personas', 'persona'],
    ['resources', 'resource'],
    ['entities', 'entity'],
    ['events', 'event'],
    ['featureInvariants', 'feature invariant']
  ] as const) {
    const change = diffCountedChildren(
      asArr(prev[field]) ?? [],
      asArr(next[field]) ?? [],
      [featureName],
      label
    );
    if (change) return change;
  }

  if (
    typeof prev.description === 'string' &&
    typeof next.description === 'string' &&
    prev.description !== next.description
  ) {
    return { op: 'edited', path: [featureName, 'description'] };
  }

  return { op: 'saved', path: [featureName] };
};

const diffProjectSnapshot = (
  prev: AnyObj,
  next: AnyObj,
  resolveFeatureName?: (featureId: string) => string | undefined
): ChangeDescriptor | null => {
  const projectName = nameOf(next, 'project');

  if (
    typeof prev.name === 'string' &&
    typeof next.name === 'string' &&
    prev.name !== next.name
  ) {
    return {
      op: 'renamed',
      path: [next.name],
      previousName: prev.name
    };
  }

  const prevFeatureIds = (asArr(prev.featureIds) ?? []).map(String);
  const nextFeatureIds = (asArr(next.featureIds) ?? []).map(String);
  const prevSet = new Set(prevFeatureIds);
  const nextSet = new Set(nextFeatureIds);
  for (const fid of nextFeatureIds) {
    if (!prevSet.has(fid)) {
      const name = resolveFeatureName?.(fid) ?? `feature ${fid.slice(0, 8)}`;
      return { op: 'added', path: [projectName, name] };
    }
  }
  for (const fid of prevFeatureIds) {
    if (!nextSet.has(fid)) {
      const name = resolveFeatureName?.(fid) ?? `feature ${fid.slice(0, 8)}`;
      return { op: 'removed', path: [projectName, name] };
    }
  }

  // Queue membership.
  const prevQueue = asArr(prev.implementationQueue) ?? [];
  const nextQueue = asArr(next.implementationQueue) ?? [];
  const prevQueueIds = new Set(prevQueue.map((q) => idOf(q) ?? '').filter(Boolean));
  const nextQueueIds = new Set(nextQueue.map((q) => idOf(q) ?? '').filter(Boolean));
  for (const q of nextQueue) {
    const qid = idOf(q);
    if (qid === null || prevQueueIds.has(qid)) continue;
    return { op: 'queued', path: [projectName, queueItemLabel(q, resolveFeatureName)] };
  }
  for (const q of prevQueue) {
    const qid = idOf(q);
    if (qid === null || nextQueueIds.has(qid)) continue;
    return { op: 'unqueued', path: [projectName, queueItemLabel(q, resolveFeatureName)] };
  }

  if (
    typeof prev.description === 'string' &&
    typeof next.description === 'string' &&
    prev.description !== next.description
  ) {
    return { op: 'edited', path: [projectName, 'description'] };
  }

  return { op: 'saved', path: [projectName] };
};

const queueItemLabel = (
  q: unknown,
  resolveFeatureName?: (featureId: string) => string | undefined
): string => {
  const o = asObj(q);
  if (!o) return 'item';
  const kind = typeof o.kind === 'string' ? o.kind : 'item';
  const featureId = typeof o.featureId === 'string' ? o.featureId : null;
  const featureName = featureId ? resolveFeatureName?.(featureId) : undefined;
  const base = featureName ?? (featureId ? `feature ${featureId.slice(0, 8)}` : 'item');
  if (kind === 'feature') return base;
  if (kind === 'surface') return `${base} (surface)`;
  if (kind === 'action') return `${base} (action)`;
  return base;
};

/**
 * Main entry. Picks the per-kind diff path; falls back to "saved" when
 * the shape isn't recognized so callers never need to handle null.
 *
 *   kind: the room kind (feature, project, ...). Used to pick a diff
 *         strategy.
 *   resolveFeatureName: optional lookup so project diffs can resolve
 *         newly-attached featureIds and queue-target featureIds into
 *         human names. Provide one in server contexts where the
 *         FeatureRepository is available; omit in tests.
 */
export const computeChangeDescriptor = (
  kind: 'feature' | 'project' | 'implementation-status',
  prev: unknown,
  next: unknown,
  resolveFeatureName?: (featureId: string) => string | undefined
): ChangeDescriptor => {
  const n = asObj(next);
  if (!n) return { op: 'saved', path: ['unknown'] };
  const p = asObj(prev);
  // No prior snapshot → freshly minted entity. "Created" reads more
  // naturally than "Added <entity name>" in this case.
  if (!p) return { op: 'created', path: [nameOf(n, kind)] };

  if (kind === 'feature') {
    const result = diffFeatureSnapshot(p, n);
    if (result) return result;
  }
  if (kind === 'project') {
    const result = diffProjectSnapshot(p, n, resolveFeatureName);
    if (result) return result;
  }
  return { op: 'saved', path: [nameOf(n, kind)] };
};

/**
 * Compact string formatter for legacy consumers that only carry a
 * `label?: string` field (like the existing HistoryEntry). Renders:
 *   added  â€º  Inbox v2 â€º Inbox List â€º Archive Item
 *   renamed â€º  Inbox v2 (was "Inbox")
 *   saved   â€º  Inbox v2
 *
 * Toast UI ignores this and renders structure-aware breadcrumbs.
 */
export const formatChangeLabel = (d: ChangeDescriptor): string => {
  const path = d.path.join(' â€º ');
  if (d.op === 'renamed' && d.previousName) {
    return `Renamed to "${d.path[d.path.length - 1]}" (was "${d.previousName}")`;
  }
  switch (d.op) {
    case 'added':
      return `Added ${path}`;
    case 'removed':
      return `Removed ${path}`;
    case 'edited':
      return `Edited ${path}`;
    case 'queued':
      return `Queued ${path}`;
    case 'unqueued':
      return `Unqueued ${path}`;
    case 'created':
      return `Created ${path}`;
    case 'deleted':
      return `Deleted ${path}`;
    case 'saved':
    default:
      return `Saved ${path}`;
  }
};
