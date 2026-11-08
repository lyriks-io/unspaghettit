/**
 * The types a proof module is written against: the port, the kernel, and the
 * parts of the model and of the verdict they carry. Types only: a module
 * receives the kernel at run time (ProverAttachment) and never imports the
 * engine.
 */
export type * from './ProverPort';
export type { ProverKernel } from './kernel';
export type { Action } from '$features/behavior-model/domain/entities/Action';
export type { ActionOutcome } from '$features/behavior-model/domain/entities/ActionOutcome';
export type { Feature } from '$features/behavior-model/domain/entities/Feature';
export type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
export type { Parameter } from '$features/behavior-model/domain/entities/Parameter';
export type { Persona, PersonaStateOverride } from '$features/behavior-model/domain/entities/Persona';
export type { Rule } from '$features/behavior-model/domain/entities/Rule';
export type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
export type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
export type { Surface } from '$features/behavior-model/domain/entities/Surface';
export type { ParameterValues } from '$features/behavior-model/domain/services/ParameterValidator';
export type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
export type { Expression } from '$features/behavior-model/domain/value-objects/Expression';
export type { Operator } from '$features/behavior-model/domain/value-objects/Operator';
export type { RuleCondition } from '$features/behavior-model/domain/value-objects/RuleCondition';
export type { StateSnapshot } from '$features/behavior-model/domain/value-objects/StatePath';
export type { StateType, StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
export type { ScenarioRunResult } from '$features/simulator/application/use-cases/RunScenarios';
export type { ExplorationReport } from '$features/simulator/domain/StateExplorer';
export type { VerdictCheck, VerdictTrace } from '$features/verification/domain/VerificationVerdict';
export type { VerificationThresholds } from '$features/verification/domain/VerificationThresholds';
export type { ReportLanguage } from '$shared/language';
