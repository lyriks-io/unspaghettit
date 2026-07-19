import { getContext, setContext } from 'svelte';
import type { Brand } from '$shared/domain/Brand';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { StateVariable } from '$features/projects/domain/entities/StateVariable';

/**
 * Opaque queue-entry id. Structurally identical to implementation-queue's
 * `QueueItemId` (same `Brand`), re-declared here so behavior-model depends on a
 * contract it OWNS rather than importing the implementation-queue feature —
 * which would form an import cycle, since implementation-queue already depends
 * on behavior-model's domain ids.
 */
export type QueueEntryId = Brand<string, 'QueueItemId'>;

/** The minimal project shape the editor needs for the "back to project" nav. */
export interface QueueHostProject {
  readonly id: string;
  readonly name: string;
}

/**
 * Port: the project/queue affordances a feature editor needs from its containing
 * project, expressed WITHOUT behavior-model importing the projects or
 * implementation-queue features. The route that owns both (the feature page)
 * wires the concrete implementation via {@link setFeatureQueueContext}; editor
 * components read it via {@link useFeatureQueueContext}. This inverts the former
 * direct `import { projectContextStore } from '$features/projects/...'` that
 * leaked a sibling feature's presentation singleton into seven editors.
 */
export interface FeatureQueueContext {
  /** Sibling features of the same project (read-only inheritance source). */
  readonly siblings: readonly Feature[];
  /** True when the open feature currently belongs to a project. */
  readonly isInProject: boolean;
  /** The containing project (id + name) for navigation, or null. */
  readonly project: QueueHostProject | null;
  /**
   * The containing project's canonical, authored state variables — the
   * "reuse from project" source for a surface's state editor. Empty when the
   * feature is standalone or the project declares none. Read-only here; only
   * the project itself (via its MCP tools / registry panel) mints them.
   */
  readonly projectStateVariables: readonly StateVariable[];
  isActionQueued(featureId: FeatureId, actionId: ActionId): boolean;
  isSurfaceQueued(featureId: FeatureId, surfaceId: SurfaceId): boolean;
  enqueueAction(featureId: FeatureId, actionId: ActionId): Promise<boolean>;
  enqueueSurface(featureId: FeatureId, surfaceId: SurfaceId): Promise<boolean>;
  dequeueByItemId(itemId: QueueEntryId): Promise<void>;
  findQueueItemIdForAction(featureId: FeatureId, actionId: ActionId): QueueEntryId | null;
  findQueueItemIdForSurface(featureId: FeatureId, surfaceId: SurfaceId): QueueEntryId | null;
}

const KEY = Symbol('feature-queue-context');

/**
 * Inert default used when an editor is rendered outside a provider (e.g. a
 * standalone feature with no project): every affordance no-ops, so components
 * never have to null-check the context.
 */
const NULL_CONTEXT: FeatureQueueContext = {
  siblings: [],
  isInProject: false,
  project: null,
  projectStateVariables: [],
  isActionQueued: () => false,
  isSurfaceQueued: () => false,
  enqueueAction: async () => false,
  enqueueSurface: async () => false,
  dequeueByItemId: async () => {},
  findQueueItemIdForAction: () => null,
  findQueueItemIdForSurface: () => null
};

/** Provide the queue context to descendant editor components (call at the route). */
export function setFeatureQueueContext(ctx: FeatureQueueContext): void {
  setContext(KEY, ctx);
}

/** Read the queue context; falls back to an inert no-op context when unprovided. */
export function useFeatureQueueContext(): FeatureQueueContext {
  return getContext<FeatureQueueContext | undefined>(KEY) ?? NULL_CONTEXT;
}
