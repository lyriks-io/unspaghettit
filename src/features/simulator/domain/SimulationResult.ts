import type {
  AppliedEffectRecord,
  EffectApplication
} from '$features/behavior-model/domain/services/EffectApplier';
import type { ParameterError } from '$features/behavior-model/domain/services/ParameterValidator';
import type { InvariantViolation } from '$features/behavior-model/domain/services/InvariantChecker';
import type {
  ActionId,
  OutcomeId,
  RuleId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { ActionOutcomeKind } from '$features/behavior-model/domain/entities/ActionOutcome';
import type { EventName } from '$features/behavior-model/domain/value-objects/EventName';
import type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';

export type SimulationStatus = 'success' | 'blocked';

/**
 * The declared outcome a successful action resolved to (see ActionOutcome).
 * Absent when the action declares no outcomes or was blocked. `status` remains
 * the coarse success/blocked gate; this is the finer semantic result.
 */
export type ActionOutcomeResult = {
  readonly name: string;
  readonly kind: ActionOutcomeKind;
  readonly outcomeId?: OutcomeId;
};

export type EvaluatedRuleRecord = {
  readonly ruleId: RuleId;
  readonly category: string;
  readonly conditionHeld: boolean;
  readonly origin: 'surface' | 'action';
};

export type SimulationMessage = {
  readonly tone: string;
  readonly text: string;
};

export type SimulationResult = {
  readonly actionId: ActionId;
  readonly status: SimulationStatus;
  readonly parameterErrors: readonly ParameterError[];
  readonly evaluatedRules: readonly EvaluatedRuleRecord[];
  readonly appliedEffects: readonly AppliedEffectRecord[];
  readonly messages: readonly SimulationMessage[];
  readonly emittedEvents: readonly EventName[];
  readonly previousState: StateSnapshot;
  readonly nextState: StateSnapshot;
  readonly invariantViolations: readonly InvariantViolation[];
  readonly transition: SurfaceId | null;
  /**
   * Which declared outcome the action resolved to (see ActionOutcome). Absent
   * when the action declares no outcomes, none matched, or it was blocked.
   */
  readonly outcome?: ActionOutcomeResult;
  /**
   * Event handlers that ran as a cascade after this action's effects.
   * Empty when no handlers subscribed, or when the simulator wasn't given
   * a feature context (legacy callers). Each entry is the SimulationResult
   * of the handler, recursive so cascades-of-cascades surface honestly.
   */
  readonly cascadedHandlers?: readonly CascadedHandlerResult[];
};

export type CascadedHandlerResult = {
  /** Event that triggered this handler. */
  readonly triggeredBy: EventName;
  /** Depth in the cascade chain; 1 for direct handlers of the root action. */
  readonly depth: number;
  /** The handler's simulation result. Carries its own (possibly nested) cascadedHandlers. */
  readonly result: SimulationResult;
};

export const fromApplication = (params: {
  actionId: ActionId;
  status: SimulationStatus;
  parameterErrors: readonly ParameterError[];
  evaluatedRules: readonly EvaluatedRuleRecord[];
  application: EffectApplication;
  previousState: StateSnapshot;
  invariantViolations: readonly InvariantViolation[];
  outcome?: ActionOutcomeResult;
  cascadedHandlers?: readonly CascadedHandlerResult[];
}): SimulationResult => ({
  actionId: params.actionId,
  status: params.status,
  parameterErrors: params.parameterErrors,
  evaluatedRules: params.evaluatedRules,
  appliedEffects: params.application.applied,
  messages: params.application.messages,
  emittedEvents: params.application.events,
  previousState: params.previousState,
  nextState: params.application.snapshot,
  invariantViolations: params.invariantViolations,
  transition: params.application.transition,
  ...(params.outcome ? { outcome: params.outcome } : {}),
  ...(params.cascadedHandlers && params.cascadedHandlers.length > 0
    ? { cascadedHandlers: params.cascadedHandlers }
    : {})
});
