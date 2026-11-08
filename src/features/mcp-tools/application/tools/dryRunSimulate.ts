import {
  simulateActionUseCase,
  type SimulateActionInput
} from '$features/simulator/application/use-cases/SimulateAction';
import type { SimulationResult } from '$features/simulator/domain/SimulationResult';

export type DryRunSimulateInput = SimulateActionInput;

export type DryRunSimulateOutput = SimulationResult;

const simulate = simulateActionUseCase();

export const dryRunSimulateTool = (input: DryRunSimulateInput): DryRunSimulateOutput =>
  simulate(input);
