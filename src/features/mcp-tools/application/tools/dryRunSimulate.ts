import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
import type {
  ActionId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
import { simulateActionUseCase } from '$features/simulator/application/use-cases/SimulateAction';
import type { SimulationResult } from '$features/simulator/domain/SimulationResult';

export type DryRunSimulateInput = {
  readonly feature: Feature;
  readonly surfaceId: SurfaceId;
  readonly actionId: ActionId;
  readonly snapshot: StateSnapshot;
  readonly parameters: ParameterValues;
};

export type DryRunSimulateOutput = SimulationResult;

const simulate = simulateActionUseCase();

export const dryRunSimulateTool = (input: DryRunSimulateInput): DryRunSimulateOutput =>
  simulate(input);
