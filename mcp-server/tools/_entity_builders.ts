/**
 * Shared "wire-shape → typed entity" builders. Single source of truth for
 * how an MCP input record maps to a Scenario / Rule / Invariant. Both the
 * granular tools (`mcp-server/tools/scenario.ts`, `rule.ts`, `invariant.ts`)
 * and the batch op handler (`mcp-server/tools/batch.ts`) call these
 * functions, so any new optional field is added in one place.
 *
 * Before this module: adding a field like `Scenario.expectedTransition`
 * required patching both the granular tool's zod schema + mapping AND the
 * matching batch.ts case. The second one got forgotten (commit `e4f1e00`
 * shipped after the granular fix in `c3c5e63` precisely because of that).
 *
 * Inputs are typed as `Record<string, unknown>` to accept either:
 *   - zod-validated input from a granular tool (already shape-checked)
 *   - raw op records from apply_batch (validated only at the discriminator
 *     level; field-level type guards live here)
 *
 * Reference resolution (`*Ref` → id via the batch's refs map) is the
 * caller's job, the batch handler resolves refs BEFORE calling these,
 * so the builders see only ids.
 */

import type {
  Invariant
} from '../../src/features/behavior-model/domain/entities/Invariant';
import type { Rule } from '../../src/features/behavior-model/domain/entities/Rule';
import type {
  Scenario,
  ScenarioAssertion,
  ScenarioStep
} from '../../src/features/behavior-model/domain/entities/Scenario';
import type { Effect } from '../../src/features/behavior-model/domain/value-objects/Effect';
import {
  asActionId,
  asEffectId,
  asInvariantId,
  asPersonaId,
  asRuleId,
  asScenarioId,
  asSurfaceId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';

type Raw = Record<string, unknown>;

// ─── Shared helpers ─────────────────────────────────────────────────────────

const buildOverrides = (raw: unknown): {
  readonly state: Scenario['stateOverrides'];
  readonly param: Scenario['parameterOverrides'];
} => {
  const r = (raw as Raw) ?? {};
  const state = (Array.isArray(r.stateOverrides) ? r.stateOverrides : []).map(
    (o: unknown) => {
      const x = o as Raw;
      return {
        path: asStatePath(x.path as string),
        value: x.value as Scenario['stateOverrides'][number]['value']
      };
    }
  );
  const param = (Array.isArray(r.parameterOverrides) ? r.parameterOverrides : []).map(
    (o: unknown, idx: number) => {
      const x = o as Raw;
      // Refuse entries without parameterName. Otherwise a slip like
      // `{parameterId: "x"}` (legacy guess) or `{name: "x"}` silently maps
      // to {parameterName: undefined} and the override no-ops at simulate
      // time - invisible until a scenario "passes" by skipping all its
      // assertions because the action got blocked for a missing required
      // param.
      if (typeof x.parameterName !== 'string' || x.parameterName.length === 0) {
        throw new Error(
          `parameterOverrides[${idx}]: parameterName (string) is required. Got ${JSON.stringify(x)}.`
        );
      }
      return {
        parameterName: x.parameterName,
        value: x.value as Scenario['parameterOverrides'][number]['value']
      };
    }
  );
  return { state, param };
};

const buildAssertion = (raw: unknown): ScenarioAssertion => {
  const a = raw as Raw;
  return {
    path: asStatePath(a.path as string),
    operator: a.operator as ScenarioAssertion['operator'],
    ...(a.value !== undefined
      ? { value: a.value as ScenarioAssertion['value'] }
      : {}),
    ...(typeof a.description === 'string' ? { description: a.description } : {})
  };
};

/**
 * Build one scenario step (a preceding action invocation). Reuses
 * `buildOverrides` so the step's parameterOverrides get the same
 * "parameterName is required" guard as scenario-level overrides.
 */
const buildStep = (raw: unknown): ScenarioStep => {
  const x = (raw as Raw) ?? {};
  if (typeof x.actionId !== 'string' || x.actionId.length === 0) {
    throw new Error(
      `scenario step: actionId (string) is required. Got ${JSON.stringify(x)}.`
    );
  }
  const { param } = buildOverrides(x);
  const expectedAssertions = Array.isArray(x.expectedAssertions)
    ? x.expectedAssertions.map(buildAssertion)
    : undefined;
  return {
    actionId: asActionId(x.actionId),
    ...(typeof x.surfaceId === 'string' ? { surfaceId: asSurfaceId(x.surfaceId) } : {}),
    parameterOverrides: param,
    ...(x.expectedStatus === 'success' || x.expectedStatus === 'blocked'
      ? { expectedStatus: x.expectedStatus as 'success' | 'blocked' }
      : {}),
    ...(expectedAssertions && expectedAssertions.length > 0 ? { expectedAssertions } : {}),
    ...(typeof x.timeAdvance === 'number' ? { timeAdvance: x.timeAdvance } : {}),
    ...(typeof x.description === 'string' ? { description: x.description } : {})
  };
};

const buildSteps = (raw: unknown): readonly ScenarioStep[] | undefined =>
  Array.isArray(raw) ? raw.map(buildStep) : undefined;

// Common pattern: "only set the field if the caller actually sent one".
// `null` is a meaningful value for some fields (e.g. expectedTransition:null
// asserts "no transition fires"), so `!== undefined` is the right guard,
// not truthiness.
const spreadIfPresent = <K extends string, V>(key: K, value: V | undefined) =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

// ─── Scenario ──────────────────────────────────────────────────────────────

/**
 * Build the body of a Scenario (everything except the id) from raw input.
 * The caller mints + supplies the id. Used by add_scenario in both paths.
 */
export const buildScenarioBody = (input: Raw): Omit<Scenario, 'id'> => {
  const ovs = buildOverrides(input);
  const steps = buildSteps(input.steps);
  const expectedAssertions = Array.isArray(input.expectedAssertions)
    ? input.expectedAssertions.map(buildAssertion)
    : undefined;
  const expectedStatus =
    input.expectedStatus === 'success' || input.expectedStatus === 'blocked'
      ? (input.expectedStatus as 'success' | 'blocked')
      : undefined;
  return {
    name: input.name as string,
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    ...(typeof input.personaId === 'string'
      ? { personaId: asPersonaId(input.personaId) }
      : {}),
    stateOverrides: ovs.state,
    parameterOverrides: ovs.param,
    ...spreadIfPresent('expectedStatus', expectedStatus),
    ...(expectedAssertions && expectedAssertions.length > 0
      ? { expectedAssertions }
      : {}),
    ...(input.expectedTransition !== undefined
      ? {
          expectedTransition:
            input.expectedTransition === null
              ? null
              : asSurfaceId(input.expectedTransition as string)
        }
      : {}),
    ...(typeof input.timeAdvance === 'number' ? { timeAdvance: input.timeAdvance } : {}),
    ...(steps && steps.length > 0 ? { steps } : {})
  };
};

/**
 * Build a Scenario patch from raw input. Only includes keys the caller
 * actually sent, so untouched fields keep their current value when merged.
 * `expectedAssertions: []` clears the existing list; `expectedTransition:null`
 * is a meaningful assertion (no transition expected).
 */
export const buildScenarioPatch = (input: Raw): Partial<Scenario> => {
  const ovs = buildOverrides(input);
  const expectedAssertionsArr = Array.isArray(input.expectedAssertions)
    ? input.expectedAssertions.map(buildAssertion)
    : undefined;
  return {
    ...(typeof input.name === 'string' ? { name: input.name } : {}),
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    ...(input.personaId !== undefined
      ? {
          personaId:
            input.personaId === null
              ? undefined
              : asPersonaId(input.personaId as string)
        }
      : {}),
    ...(Array.isArray(input.stateOverrides) ? { stateOverrides: ovs.state } : {}),
    ...(Array.isArray(input.parameterOverrides)
      ? { parameterOverrides: ovs.param }
      : {}),
    ...(input.expectedStatus === 'success' || input.expectedStatus === 'blocked'
      ? { expectedStatus: input.expectedStatus as 'success' | 'blocked' }
      : {}),
    ...(expectedAssertionsArr !== undefined
      ? expectedAssertionsArr.length === 0
        ? { expectedAssertions: undefined }
        : { expectedAssertions: expectedAssertionsArr }
      : {}),
    ...(input.expectedTransition !== undefined
      ? {
          expectedTransition:
            input.expectedTransition === null
              ? null
              : asSurfaceId(input.expectedTransition as string)
        }
      : {}),
    // timeAdvance:0 (or null) clears it; a positive number sets it.
    ...(input.timeAdvance !== undefined
      ? { timeAdvance: typeof input.timeAdvance === 'number' && input.timeAdvance > 0 ? input.timeAdvance : undefined }
      : {}),
    // `steps: []` clears the sequence (back to a single-action preset);
    // omitting steps keeps the current value.
    ...(Array.isArray(input.steps)
      ? input.steps.length === 0
        ? { steps: undefined }
        : { steps: buildSteps(input.steps) }
      : {})
  };
};

/** Convenience: build a complete Scenario with an id. */
export const buildScenario = (input: Raw, mintId: () => string): Scenario => ({
  id: asScenarioId(mintId()),
  ...buildScenarioBody(input)
});

// ─── Rule ──────────────────────────────────────────────────────────────────

/**
 * Build a Rule from raw input. Mints both the rule id AND the effect id
 * (since rule.effect is part of the rule shape, if the input didn't carry
 * an effect.id we need to mint one here).
 */
export const buildRule = (input: Raw, mintId: () => string): Rule => {
  const effect = (input.effect as Raw) ?? {};
  return {
    id: asRuleId(mintId()),
    category: input.category as Rule['category'],
    condition: input.condition as Rule['condition'],
    effect: {
      ...(effect as object),
      id: asEffectId(((effect.id as string | undefined) ?? mintId()))
    } as Rule['effect'],
    ...(typeof input.description === 'string' ? { description: input.description } : {})
  };
};

/**
 * Build a Rule patch. The caller supplies the existing rule so we can
 * preserve the effect's id when the patch only sends partial effect fields.
 * Granular tools always pass an existing rule; the batch handler does too
 * since updates go through updateRuleOn{Surface,Capability} after a find.
 */
export const buildRulePatch = (input: Raw, existing: Rule): Rule => ({
  ...existing,
  ...(input.category !== undefined ? { category: input.category as Rule['category'] } : {}),
  ...(input.condition !== undefined
    ? { condition: input.condition as Rule['condition'] }
    : {}),
  ...(input.effect !== undefined
    ? {
        effect: {
          ...(input.effect as object),
          id: asEffectId(
            ((input.effect as { id?: string }).id ?? String(existing.effect.id))
          )
        } as Rule['effect']
      }
    : {}),
  ...(typeof input.description === 'string' ? { description: input.description } : {})
});

// ─── Invariant ──────────────────────────────────────────────────────────────

export const buildInvariant = (input: Raw, mintId: () => string): Invariant => ({
  id: asInvariantId(mintId()),
  name: input.name as string,
  condition: input.condition as Invariant['condition'],
  message: input.message as string,
  ...(typeof input.description === 'string' ? { description: input.description } : {})
});

/** Build an Invariant patch. Caller supplies existing for id preservation. */
export const buildInvariantPatch = (input: Raw): Partial<Invariant> => ({
  ...(typeof input.name === 'string' ? { name: input.name } : {}),
  ...(input.condition !== undefined
    ? { condition: input.condition as Invariant['condition'] }
    : {}),
  ...(typeof input.message === 'string' ? { message: input.message } : {}),
  ...(typeof input.description === 'string' ? { description: input.description } : {})
});

// Re-export the effect-id helper so batch.ts builders can reuse it without
// importing from a deep value-object path.
export { asEffectId as mintEffectId } from '../../src/features/behavior-model/domain/value-objects/ids';
// Same for the Effect type so callers can type their effect builders.
export type { Effect };
