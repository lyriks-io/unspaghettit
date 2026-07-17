import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
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
