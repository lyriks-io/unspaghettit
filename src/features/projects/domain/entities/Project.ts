import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';
import type { DomainId } from '$features/domains/domain/value-objects/ids';
import type { QueueItem } from '$features/implementation-queue/domain/entities/QueueItem';
import type { Tag } from '$shared/domain/Tags';
import type { ProjectId } from '../value-objects/ids';

export type Project = {
  readonly id: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly customTagType?: string;
  readonly customTag?: string;
  readonly featureIds: readonly FeatureId[];
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
