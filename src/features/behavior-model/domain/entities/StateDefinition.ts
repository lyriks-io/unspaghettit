import type { StateDefinitionId, SurfaceId } from '../value-objects/ids';
import type { StatePath } from '../value-objects/StatePath';
import type { StateType, StateValue } from '../value-objects/StateValue';

export type StateDefinition = {
  readonly id: StateDefinitionId;
  readonly path: StatePath;
  readonly type: StateType;
  readonly defaultValue: StateValue;
  readonly enumValues?: readonly string[];
  readonly description?: string;
  /**
   * Surfaces (other than the owning surface) that also read or write this
   * state path. Declarative only. The runtime already accesses any path
   * across surfaces because the snapshot is global. But the dashboard uses
   * it to render the spec-vs-code diff honestly and to flag dangling refs
   * when a sharing surface is deleted. Empty/absent means "this surface
   * only".
   */
  readonly sharedWith?: readonly SurfaceId[];
};
