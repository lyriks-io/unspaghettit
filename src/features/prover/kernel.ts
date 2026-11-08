import { CALLER_CHANNEL_PARAM, isEvolution } from '$features/behavior-model/domain/entities/Action';
import { statesReadBy } from '$features/behavior-model/domain/services/conditionReads';
import {
  decidedBy,
  guardReads,
  stateWritesOf,
  writeMoves
} from '$features/behavior-model/domain/services/stateWrites';
import { analyzeActionDecisions } from '$features/behavior-model/domain/services/DecisionAnalysis';
import { checkInvariants } from '$features/behavior-model/domain/services/InvariantChecker';
import { evaluateCondition } from '$features/behavior-model/domain/services/RuleEvaluator';
import {
  buildInitialSnapshot,
  startingDeclarations
} from '$features/behavior-model/domain/services/StateSnapshot';
import { ALL_EFFECT_TYPES } from '$features/behavior-model/domain/value-objects/Effect';
import { deepEqualValue, isExpression } from '$features/behavior-model/domain/value-objects/Expression';
import { ALL_OPERATORS } from '$features/behavior-model/domain/value-objects/Operator';
import { parameterTypeToStateType } from '$features/behavior-model/domain/value-objects/ParameterType';
import {
  flattenLeafConditions,
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition
} from '$features/behavior-model/domain/value-objects/RuleCondition';
import { asStatePath, readPath, writePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { runScenariosUseCase } from '$features/simulator/application/use-cases/RunScenarios';
import { DEFAULT_MAX_COMBOS, parameterCombinations } from '$features/simulator/domain/ParameterDomains';
import { simulate } from '$features/simulator/domain/SimulatorEngine';
import { NBSP, quoteName } from '$shared/language';

/**
 * The version of the contract a proof module is built against. It changes
 * whenever an entry of `proverKernel` or of the port (ProverPort.ts) changes
 * shape; the engine refuses a module built for another one, so a mismatch
 * never proves anything.
 */
export const KERNEL_API = 1;

/**
 * Everything a proof module may use from the engine at run time, and nothing
 * else: the semantics of the model (how a condition is read, what a step does,
 * where a run starts), so a proof replays its paths with exactly the simulator
 * the engine runs, never a copy of it. The module receives this object from the
 * engine (in its own process, and through `kernelEntry` in the processes it
 * starts); it never imports the engine.
 */
export const proverKernel = {
  api: KERNEL_API,
  /**
   * The model's vocabulary as this engine knows it. A module that meets an
   * operator or an effect it was not built to translate answers that element
   * as not supported, never as proved.
   */
  vocabulary: {
    operators: ALL_OPERATORS,
    effectTypes: ALL_EFFECT_TYPES
  },
  CALLER_CHANNEL_PARAM,
  isEvolution,
  statesReadBy,
  analyzeActionDecisions,
  checkInvariants,
  evaluateCondition,
  buildInitialSnapshot,
  startingDeclarations,
  deepEqualValue,
  isExpression,
  parameterTypeToStateType,
  flattenLeafConditions,
  isCompositeCondition,
  isParamLeft,
  isQuantifierCondition,
  asStatePath,
  readPath,
  writePath,
  runScenariosUseCase,
  DEFAULT_MAX_COMBOS,
  parameterCombinations,
  simulate,
  NBSP,
  quoteName,
  stateWritesOf,
  guardReads,
  decidedBy,
  writeMoves
} as const;

export type ProverKernel = typeof proverKernel;
