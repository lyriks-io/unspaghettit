import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';

/**
 * Entities the audit/report loop knows how to track.
 *
 * Action-scoped (live under `actions[]`):
 *   action, event, rule, invariant, transition.
 * Surface-scoped (live under `surfaces[]`):
 *   state, data, surface_rule, surface_invariant.
 *
 * Events keep their own type so the existing
 * `@unspa:<cap-slug>#<event>` tag format stays valid alongside the newer
 * `@unspa:<entity-type>:<id-or-slug>` format used by everything else.
 */
export type EntityType =
  | 'action'
  | 'event'
  | 'rule'
  | 'invariant'
  | 'transition'
  | 'state'
  | 'data'
  | 'surface_rule'
  | 'surface_invariant';

export const ALL_ENTITY_TYPES: readonly EntityType[] = [
  'action',
  'event',
  'rule',
  'invariant',
  'transition',
  'state',
  'data',
  'surface_rule',
  'surface_invariant'
];

export const CAPABILITY_SCOPED_ENTITY_TYPES: readonly EntityType[] = [
  'action',
  'event',
  'rule',
  'invariant',
  'transition'
];

export const SURFACE_SCOPED_ENTITY_TYPES: readonly EntityType[] = [
  'state',
  'data',
  'surface_rule',
  'surface_invariant'
];

/**
 * Where a `@unspa:...` tag was located in the implementation repo. `file` is
 * whatever path the LLM reported (typically relative to the repo root). The
 * optional `snippet` is a short slice of source captured at the tag site so
 * the dashboard can show the *real* code beside the spec without the user
 * leaving the feature.
 */
export type TagLocation = {
  readonly file: string;
  readonly line?: number;
  readonly snippet?: string;
  /**
   * True when the audited signature could not be located at (or within ±2 lines
   * of) the indexed line. Surfaced by the dashboard so re-audit drift is
   * visible without manually diffing every entry.
   */
  readonly stale?: boolean;
  /**
   * If `stale` and the signature was still findable elsewhere in the same
   * file, this is the 1-based line where it now lives. Lets the dashboard
   * show real code instead of a misleading slice at the stale line.
   */
  readonly suggestedLine?: number;
};

export type ExpectedEntity = {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly entityName?: string;
  readonly tag: string;
};

export type FoundEntity = {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly entityName?: string;
  readonly tag: string;
  readonly locations: readonly TagLocation[];
  /**
   * Free-form JSON blob the LLM extracted from code, shaped like the spec
   * entity (rule.condition.{left,operator,right}, state.{type,defaultValue},
   * data.fields[], etc.). Powers the field-level diff. Optional. Older
   * reports without it still load.
   */
  readonly capturedFields?: unknown;
  /** When the LLM grep-and-captured this entity. Per-entity, not per-location. */
  readonly capturedAt: string;
};

export type MissingEntity = {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly entityName?: string;
  readonly tag: string;
};

export type ExtraTag = {
  readonly tag: string;
  readonly locations: readonly TagLocation[];
};

/**
 * A reported entity that didn't match anything in the spec. Surfaced in the
 * report ack so the caller can see when their `foundEntities[]` payload was
 * silently dropped — typical causes are wrong id format (e.g. passing a name
 * where an 8-char hex id is expected) or a stale id (entity removed from the
 * spec). Not persisted; only carried on the synchronous response.
 */
export type RejectedEntity = {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly reason: string;
};

/**
 * Audit-time metadata read from the behavioral index (.unspa.json). Stored
 * alongside each action/surface report so the dashboard can show staleness
 * signals and navigation hints without re-reading the index file.
 */
export type AuditMeta = {
  /** ISO timestamp of the last audit pass that produced this entry. */
  readonly auditedAt?: string;
  /** Git commit SHA of the primary implementation file at audit time. */
  readonly gitCommit?: string;
  /** Feature updatedAt at audit time. Compare to current to detect spec drift. */
  readonly specVersion?: string;
  /** Implementation pattern hint: svelte-route | svelte-store | svelte-component | mcp-tool | mcp-entrypoint | domain-service */
  readonly kind?: string;
  /** Additional files involved in this entity's implementation. */
  readonly relatedFiles?: readonly { readonly file: string; readonly line: number; readonly role: string }[];
  /** Test file that covers this entity. Run with `vitest run <testFile>`. */
  readonly testFile?: string;
  /** Structured list of spec elements not yet implemented. */
  readonly knownGaps?: readonly string[];
};

/**
 * Snapshot of how a single action's tagged surface area looks in the
 * implementation repo at the time the LLM ran the audit grep. `expectedEntities`
 * is the spec at report time so we can detect drift even if the feature is
 * later edited (the report ages out of sync rather than silently re-aligning).
 */
export type ActionImplementationStatus = {
  readonly actionId: ActionId;
  readonly actionSlug: string;
  readonly actionName: string;
  readonly surfaceId: SurfaceId;
  readonly expectedEntities: readonly ExpectedEntity[];
  readonly foundEntities: readonly FoundEntity[];
  readonly missingEntities: readonly MissingEntity[];
  readonly extraTags: readonly ExtraTag[];
  readonly reportedAt: string;
  readonly auditMeta?: AuditMeta;
};

/**
 * Surface-scoped snapshot. Covers entities that don't belong to a single
 * action: state definitions, data namespaces, surface-level rules and
 * invariants. Same shape as ActionImplementationStatus but keyed on the
 * surface.
 */
export type SurfaceImplementationStatus = {
  readonly surfaceId: SurfaceId;
  readonly surfaceSlug: string;
  readonly surfaceName: string;
  readonly expectedEntities: readonly ExpectedEntity[];
  readonly foundEntities: readonly FoundEntity[];
  readonly missingEntities: readonly MissingEntity[];
  readonly extraTags: readonly ExtraTag[];
  readonly reportedAt: string;
  readonly auditMeta?: AuditMeta;
};

/**
 * Sidecar artifact persisted next to the feature JSON. Lives at
 * `unspa/<featureId>.implementation-status.json`. Volatile by design -
 * it tracks one repo's implementation state at a moment in time.
 */
export type ImplementationStatus = {
  readonly featureId: FeatureId;
  readonly revision: number;
  readonly updatedAt: string;
  readonly actions: readonly ActionImplementationStatus[];
  readonly surfaces: readonly SurfaceImplementationStatus[];
};

export const emptyImplementationStatus = (
  featureId: FeatureId,
  now: string
): ImplementationStatus => ({
  featureId,
  revision: 0,
  updatedAt: now,
  actions: [],
  surfaces: []
});

/**
 * Replace (or insert) an action's status entry, bump the revision, refresh
 * `updatedAt`. Pure. Used by the report use-case and easy to unit-test.
 */
export const upsertActionStatus = (
  status: ImplementationStatus,
  next: ActionImplementationStatus,
  now: string
): ImplementationStatus => {
  const others = status.actions.filter((c) => c.actionId !== next.actionId);
  return {
    ...status,
    revision: status.revision + 1,
    updatedAt: now,
    actions: [...others, next]
  };
};

/**
 * Replace (or insert) a surface's status entry, bump the revision, refresh
 * `updatedAt`. Pure. Counterpart to upsertActionStatus.
 */
export const upsertSurfaceStatus = (
  status: ImplementationStatus,
  next: SurfaceImplementationStatus,
  now: string
): ImplementationStatus => {
  const others = status.surfaces.filter((s) => s.surfaceId !== next.surfaceId);
  return {
    ...status,
    revision: status.revision + 1,
    updatedAt: now,
    surfaces: [...others, next]
  };
};

/** Drop the entry for an action id (used when the action is deleted). */
export const removeActionStatus = (
  status: ImplementationStatus,
  actionId: ActionId,
  now: string
): ImplementationStatus => {
  const filtered = status.actions.filter((c) => c.actionId !== actionId);
  if (filtered.length === status.actions.length) return status;
  return {
    ...status,
    revision: status.revision + 1,
    updatedAt: now,
    actions: filtered
  };
};

/** Drop the entry for a surface id (used when the surface is deleted). */
export const removeSurfaceStatus = (
  status: ImplementationStatus,
  surfaceId: SurfaceId,
  now: string
): ImplementationStatus => {
  const filtered = status.surfaces.filter((s) => s.surfaceId !== surfaceId);
  if (filtered.length === status.surfaces.length) return status;
  return {
    ...status,
    revision: status.revision + 1,
    updatedAt: now,
    surfaces: filtered
  };
};

/** Filter helpers used by the UI to avoid scattering entity-type checks. */
export const eventsOf = (entries: readonly { readonly entityType: EntityType }[]) =>
  entries.filter((e) => e.entityType === 'event');

export const nonEventsOf = (entries: readonly { readonly entityType: EntityType }[]) =>
  entries.filter((e) => e.entityType !== 'event');
