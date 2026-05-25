import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  ActionId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import { simulate } from '$features/simulator/domain/SimulatorEngine';
import type { SimulationResult } from '$features/simulator/domain/SimulationResult';

export type SimulateActionInput = {
  readonly feature: Feature;
  readonly surfaceId: SurfaceId;
  readonly actionId: ActionId;
  readonly snapshot: StateSnapshot;
  readonly parameters: ParameterValues;
  /**
   * Sibling features in the same project. When provided, the cascade will
   * find handlers declared in those features too, so an event emitted by
   * the focal action can trigger reactions across the whole project, not
   * just within the focal feature. Caller is responsible for fetching them
   * (typically: load the project, fetch every featureId except the focal).
   */
  readonly projectFeatures?: readonly Feature[];
};

export const simulateActionUseCase = () => {
  return (input: SimulateActionInput): SimulationResult => {
    const surface = input.feature.surfaces.find((s) => s.id === input.surfaceId);
    if (!surface) {
      throw new Error(`Surface ${input.surfaceId} not found`);
    }
    const action = surface.actions.find((c) => c.id === input.actionId);
    if (!action) {
      throw new Error(`Action ${input.actionId} not found`);
    }
    return simulate({
      surface,
      action,
      snapshot: input.snapshot,
      parameters: input.parameters,
      featureInvariants: input.feature.featureInvariants,
      feature: input.feature,
      ...(input.projectFeatures ? { projectFeatures: input.projectFeatures } : {})
    });
  };
};
