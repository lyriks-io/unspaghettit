import type {
  StateType,
  StateValue
} from '$features/behavior-model/domain/value-objects/StateValue';
import type {
  EntityFieldId,
  EntityId,
  FeatureId,
  SurfaceId,
  ValueSetId
} from '$features/behavior-model/domain/value-objects/ids';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateVariableId } from '../value-objects/ids';

export type StateVariableProjection = {
  readonly featureId: FeatureId;
  readonly surfaceId: SurfaceId;
};

export type StateVariableDataFieldLink = {
  readonly featureId: FeatureId;
  readonly entityId: EntityId;
  readonly fieldId: EntityFieldId;
};

export type StateVariableBuilderBinding =
  | { readonly seed: true }
  | { readonly nodeId: string; readonly kind: 'state' };

/** Project-scoped identity for one logical state value across all projections. */
export type StateVariable = {
  readonly id: StateVariableId;
  readonly path: StatePath;
  readonly type: StateType;
  readonly defaultValue: StateValue;
  readonly description: string;
  readonly valueSetId?: ValueSetId;
  readonly enumValues?: readonly string[];
  readonly owner: StateVariableProjection;
  readonly readers: readonly StateVariableProjection[];
  readonly writers: readonly StateVariableProjection[];
  readonly links?: {
    readonly dataField?: StateVariableDataFieldLink;
    readonly builderBinding?: StateVariableBuilderBinding;
  };
};
