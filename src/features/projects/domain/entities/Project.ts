import type { Entity } from '$features/behavior-model/domain/entities/Entity';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { Persona } from '$features/behavior-model/domain/entities/Persona';
import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { QueueItem } from '$features/implementation-queue/domain/entities/QueueItem';
import type { Tag } from '$shared/domain/Tags';
import type { CoreFeature } from './CoreFeature';
import type { ProjectId } from '../value-objects/ids';
import type { StateVariable } from './StateVariable';

export type Project = {
  readonly id: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly customTagType?: string;
  readonly customTag?: string;
  readonly featureIds: readonly FeatureId[];
  /** Canonical project-scoped state identities. Absent on legacy snapshots. */
  readonly stateVariables?: readonly StateVariable[];
  /**
   * The project's canonical ENTITY LIBRARY: domain objects defined once here
   * and REFERENCED from member features via `feature.entityRefs`, instead of
   * being copied into every feature that touches them. The same
   * store-it-once-with-a-stable-id idea as `stateVariables`, extended from a
   * single state path to a whole entity.
   *
   * The project-scoped repository decorator resolves each member feature's refs
   * into its `entities[]` on load and strips them on save, so every downstream
   * consumer (validator, model checker, digest, dashboard) sees a
   * self-contained feature while the definition lives in exactly one place.
   *
   * Optional and additive; downstream reads `project.entities ?? []`.
   */
  readonly entities?: readonly Entity[];
  /** Canonical resource library. See `entities`. */
  readonly resources?: readonly Resource[];
  /** Canonical persona library. See `entities`. */
  readonly personas?: readonly Persona[];
  /**
   * Cross-FEATURE invariants — safety properties that span the whole project,
   * referencing state paths declared in different member features (e.g. "the
   * orders feature's open count equals the billing feature's unpaid count").
   * A feature invariant can't express this (its validator rejects paths not
   * declared on its own surfaces). The verification spine enforces these over
   * the union of the project's features' state during bounded model checking,
   * and reports any reachable violation with the action path that reaches it.
   * Optional and additive; downstream reads `project.projectInvariants ?? []`.
   */
  readonly projectInvariants?: readonly Invariant[];
  /**
   * The project's declared CORE FEATURES: a curated registry of product pillars
   * that member features are grouped under. A feature joins one by carrying a
   * reserved `core:<value>` tag (CORE_TAG_TYPE); the tag only counts as a real
   * core feature when its value resolves to an entry here, which is what keeps
   * the core-feature vocabulary precise instead of a sea of free-form tags. A
   * feature belongs to at most one. Optional and additive; downstream reads
   * `project.coreFeatures ?? []`. A member tag naming an undeclared value (or a
   * feature carrying more than one) is a SOFT warning surfaced in the project
   * aggregate, never a save blocker.
   */
  readonly coreFeatures?: readonly CoreFeature[];
  /**
   * Optional parent Domain. Projects predating the Domain layer leave this
   * undefined. New projects created from Domain Editor get the active
   * domain stamped on them automatically.
   */
  readonly domainId?: DomainId;
  /**
   * Ordered "implement next" list. Each entry points at a Feature or a
   * single Action inside one of this project's features. The queue is
   * authored by humans (drag-and-drop in the dashboard) or by the LLM via
   * MCP, so a developer can say "implement next" and the model picks the
   * top live entry without having to name it. Optional for back-compat:
   * pre-queue project files load with an empty queue.
   */
  readonly implementationQueue?: readonly QueueItem[];
  readonly createdAt: string;
  readonly updatedAt: string;
};
