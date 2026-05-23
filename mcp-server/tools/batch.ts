import { z } from 'zod';
import {
  FeatureNotFoundError,
  FeatureValidationError
} from '../../src/features/behavior-model/application/use-cases/MutateFeature';
import * as T from '../../src/features/behavior-model/domain/services/FeatureTransforms';
import {
  validateFeature,
  validateReferenceIntegrity
} from '../../src/features/behavior-model/domain/services/FeatureValidator';
import { scoreFeature } from '../../src/features/maturity/domain/MaturityScorer';
import { scoreFeatureTool } from '../../src/features/mcp-tools/application/tools/scoreFeature';
import type { Action } from '../../src/features/behavior-model/domain/entities/Action';
import type { Entity, EntityField } from '../../src/features/behavior-model/domain/entities/Entity';
import type {
  EventDefinition,
  EventPayloadField
} from '../../src/features/behavior-model/domain/entities/EventDefinition';
import type { Feature } from '../../src/features/behavior-model/domain/entities/Feature';
import type { Invariant } from '../../src/features/behavior-model/domain/entities/Invariant';
import type { Parameter } from '../../src/features/behavior-model/domain/entities/Parameter';
import type { Persona } from '../../src/features/behavior-model/domain/entities/Persona';
import type { Resource } from '../../src/features/behavior-model/domain/entities/Resource';
import type { Rule } from '../../src/features/behavior-model/domain/entities/Rule';
import type {
  Scenario,
  ScenarioAssertion
} from '../../src/features/behavior-model/domain/entities/Scenario';
import type { StateDefinition } from '../../src/features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '../../src/features/behavior-model/domain/entities/Surface';
import type { Transition } from '../../src/features/behavior-model/domain/entities/Transition';
import type { Effect } from '../../src/features/behavior-model/domain/value-objects/Effect';
import type { EventName } from '../../src/features/behavior-model/domain/value-objects/EventName';
import {
  asActionId,
  asEntityFieldId,
  asEntityId,
  asEffectId,
  asEventDefinitionId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asPersonaId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId,
  asTransitionId
} from '../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../src/features/behavior-model/domain/value-objects/StatePath';
import {
  buildInvariant as buildInvariantBody,
  buildInvariantPatch,
  buildScenario,
  buildScenarioPatch
} from './_entity_builders';
import { errorText, text, type ToolDeps } from './_shared';
import { expandFeatureId } from './short-ids';
import { maybeAutoGenerateTypes } from './_codegen';

type Op = Record<string, unknown> & { readonly kind: string };
type Refs = Record<string, string>;

const get = <K extends string>(op: Op, key: K): unknown => op[key];

const resolve = (op: Op, refs: Refs, refKey: string, idKey: string): string => {
  const refName = get(op, refKey);
  if (typeof refName === 'string' && refName.length > 0) {
    const id = refs[refName];
    if (!id) throw new Error(`${op.kind}: unknown ${refKey} "${refName}"`);
    return id;
  }
  const id = get(op, idKey);
  if (typeof id !== 'string' || id.length === 0)
    throw new Error(`${op.kind}: missing ${idKey} or ${refKey}`);
  return id;
};

const optional = (op: Op, refKey: string, idKey: string, refs: Refs): string | undefined => {
  const refName = get(op, refKey);
  if (typeof refName === 'string' && refName.length > 0) {
    const id = refs[refName];
    if (!id) throw new Error(`${op.kind}: unknown ${refKey} "${refName}"`);
    return id;
  }
  const id = get(op, idKey);
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};

const resolveIdOrRefValue = (value: string, refs: Refs): string => refs[value] ?? value;

/**
 * Resolve scenario refs against the batch's refs map into concrete ids,
 * mirroring how `targetRef` is resolved on transitions and transition_surface
 * effects. Scenario builders see only ids, keeping ref-resolution as the
 * caller's contract.
 *
 * `null` is preserved as a meaningful value ("no transition expected"), and an
 * already-set `expectedTransition` field wins so an explicit id beats a ref.
 */
const resolveScenarioRefs = (op: Op, refs: Refs): Op => {
  let next = op;
  const transitionRef = get(op, 'expectedTransitionRef');
  if (
    typeof transitionRef === 'string' &&
    transitionRef.length > 0 &&
    get(op, 'expectedTransition') === undefined
  ) {
    const resolved = refs[transitionRef];
    if (!resolved) {
      throw new Error(`${op.kind}: unknown expectedTransitionRef "${transitionRef}"`);
    }
    next = { ...next, expectedTransition: resolved };
  }

  const personaRef = get(op, 'personaRef');
  if (
    typeof personaRef === 'string' &&
    personaRef.length > 0 &&
    get(op, 'personaId') === undefined
  ) {
    const resolved = refs[personaRef];
    if (!resolved) throw new Error(`${op.kind}: unknown personaRef "${personaRef}"`);
    next = { ...next, personaId: resolved };
  }
  return next;
};

const resolveSharedWith = (op: Op, refs: Refs): StateDefinition['sharedWith'] | undefined => {
  if (!Array.isArray(op.sharedWith) || op.sharedWith.length === 0) return undefined;
  return (op.sharedWith as readonly string[]).map((s) =>
    asSurfaceId(resolveIdOrRefValue(s, refs))
  ) as StateDefinition['sharedWith'];
};

const directionDelta = (op: Op): -1 | 1 => {
  const d = get(op, 'direction');
  if (d === 'up') return -1;
  if (d === 'down') return 1;
  throw new Error(`${op.kind}: direction must be "up" or "down"`);
};

const buildEffect = (
  mintId: () => string,
  raw: Record<string, unknown>,
  refs: Refs
): Effect => {
  const out: Record<string, unknown> = { ...raw };
  // transition_surface effects accept targetRef so a freshly-created surface
  // (added earlier in the same batch under op.ref) can be wired in without
  // copying the minted id by hand. Mirrors how add_transition resolves its
  // own targetRef.
  if (out.type === 'transition_surface' && typeof out.targetRef === 'string') {
    const resolved = refs[out.targetRef as string];
    if (!resolved) throw new Error(`unknown targetRef "${out.targetRef as string}"`);
    out.target = resolved;
    delete out.targetRef;
  }
  return {
    ...out,
    id: asEffectId((out.id as string | undefined) ?? mintId())
  } as unknown as Effect;
};

const buildRule = (mintId: () => string, raw: Op, refs: Refs): Rule => {
  const effect = get(raw, 'effect') as Record<string, unknown> | undefined;
  if (!effect) throw new Error(`${raw.kind}: rule.effect is required`);
  const condition = get(raw, 'condition');
  return {
    id: asRuleId(mintId()),
    category: get(raw, 'category') as Rule['category'],
    condition: condition as unknown as Rule['condition'],
    effect: buildEffect(mintId, effect, refs) as unknown as Rule['effect'],
    ...(typeof get(raw, 'description') === 'string'
      ? { description: get(raw, 'description') as string }
      : {})
  };
};

// NOTE: Invariant entity construction now lives in
// `mcp-server/tools/_entity_builders.ts` (imported here as buildInvariantBody)
// so the granular invariant.ts MCP tool and this batch op handler share a
// single source of truth. Rule construction stays local because batch's
// rule builder also resolves `effect.targetRef` against `refs`, which the
// granular tool never sees.

const buildDataField = (mintId: () => string, raw: Record<string, unknown>): EntityField => {
  const fields = raw.fields as readonly Record<string, unknown>[] | undefined;
  const items = raw.items as Record<string, unknown> | undefined;
  return {
    id: asEntityFieldId(mintId()),
    name: raw.name as string,
    type: raw.type as EntityField['type'],
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw.required === 'boolean' ? { required: raw.required } : {}),
    ...(Array.isArray(raw.enumValues) ? { enumValues: raw.enumValues as readonly string[] } : {}),
    ...(typeof raw.path === 'string' ? { path: asStatePath(raw.path) } : {}),
    ...(fields ? { fields: fields.map((f) => buildDataField(mintId, f)) } : {}),
    ...(items ? { items: buildDataField(mintId, items) } : {})
  };
};

const buildOverrides = (
  raw: unknown
): { state: Persona['stateOverrides']; param: Persona['parameterOverrides'] } => {
  const r = (raw as Record<string, unknown>) ?? {};
  const state = (Array.isArray(r.stateOverrides) ? r.stateOverrides : []).map((o: unknown) => {
    const x = o as Record<string, unknown>;
    return {
      path: asStatePath(x.path as string),
      value: x.value as Persona['stateOverrides'][number]['value']
    };
  });
  const param = (Array.isArray(r.parameterOverrides) ? r.parameterOverrides : []).map(
    (o: unknown) => {
      const x = o as Record<string, unknown>;
      return {
        parameterName: x.parameterName as string,
        value: x.value as Persona['parameterOverrides'][number]['value']
      };
    }
  );
  return { state, param };
};

/**
 * Walk the ops list once, folding each op into the running feature.
 * `add_*` ops capture the new id under op.ref (if provided) so subsequent
 * ops can address it via `*Ref` instead of `*Id`. Throws on the first
 * malformed op so the caller sees exactly which one broke.
 *
 * Also returns `mintIdToOp`: a map from every server-minted id to the index
 * of the op that produced it. The apply_batch caller uses this to annotate
 * validation errors (which reference entity ids like "Action 7bfd0b83") with
 * the op index that introduced them, so the agent knows exactly which op
 * to fix rather than scanning the whole batch.
 */
const applyOps = (start: Feature, ops: readonly Op[], rawMintId: () => string): {
  next: Feature;
  refs: Refs;
  mintIdToOp: ReadonlyMap<string, number>;
} => {
  let exp = start;
  const refs: Refs = {};
  const mintIdToOp = new Map<string, number>();
  const remember = (ref: unknown, id: string) => {
    if (typeof ref === 'string' && ref.length > 0) refs[ref] = id;
  };

  let currentOpIndex = -1;
  // Shadow the raw mintId with a tracking variant for the rest of the
  // function. Every minted id gets recorded with the index of the op that
  // produced it so apply_batch can attribute validation errors back to a
  // specific op number.
  const mintId = (): string => {
    const id = rawMintId();
    if (currentOpIndex >= 0) mintIdToOp.set(id, currentOpIndex);
    return id;
  };

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    currentOpIndex = i;
    try {
      switch (op.kind) {
        // ── Surface ─────────────────────────────────────────────────────
        case 'add_surface': {
          const surface: Surface = {
            id: asSurfaceId(mintId()),
            name: op.name as string,
            type: op.type as Surface['type'],
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            stateDefinitions: [],
            actions: [],
            rules: [],
            invariants: [],
            transitions: [],
            ...(typeof op.parentRef === 'string' || typeof op.parentSurfaceId === 'string'
              ? { parentSurfaceId: asSurfaceId(resolve(op, refs, 'parentRef', 'parentSurfaceId')) }
              : {})
          };
          exp = T.addSurface(exp, surface);
          remember(op.ref, surface.id);
          break;
        }
        case 'update_surface': {
          const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
          exp = T.renameSurface(exp, sid, {
            ...(typeof op.name === 'string' ? { name: op.name } : {}),
            ...(typeof op.type === 'string' ? { type: op.type as Surface['type'] } : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {})
          });
          if ('parentSurfaceId' in op || 'parentRef' in op) {
            const parent = optional(op, 'parentRef', 'parentSurfaceId', refs);
            exp = T.setSurfaceParent(exp, sid, parent ? asSurfaceId(parent) : null);
          }
          break;
        }
        case 'remove_surface':
          exp = T.removeSurface(exp, asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')));
          break;
        case 'move_surface':
          exp = T.moveSurfaceBy(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            directionDelta(op)
          );
          break;

        // ── Action ──────────────────────────────────────────────────
        case 'add_action': {
          const cap: Action = {
            id: asActionId(mintId()),
            name: op.name as string,
            intent: op.intent as string,
            parameters: [],
            requiredStates: ((op.requiredStates as readonly string[] | undefined) ??
              []) as unknown as Action['requiredStates'],
            rules: [],
            invariants: [],
            effects: [],
            // Accepting `emittedEvents` here avoids the add_action +
            // update_action dance that was previously needed just to
            // declare the events a brand-new action emits.
            emittedEvents: ((op.emittedEvents as readonly string[] | undefined) ??
              []) as unknown as Action['emittedEvents'],
            transitions: [],
            // Repair / admin actions opt out of invariant checks. See
            // Action.bypassInvariants doc, only set this when the action's
            // whole purpose is to recover from a broken invariant.
            ...(op.bypassInvariants === true ? { bypassInvariants: true } : {}),
            // Subscribe this action to an event. When ANY action in the
            // feature emits the named event the simulator cascades into
            // this one. See Action.triggeredByEvent doc.
            ...(typeof op.triggeredByEvent === 'string' && op.triggeredByEvent.length > 0
              ? { triggeredByEvent: op.triggeredByEvent as Action['triggeredByEvent'] }
              : {})
          };
          exp = T.addAction(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            cap
          );
          remember(op.ref, cap.id);
          break;
        }
        case 'update_action':
          exp = T.updateAction(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            {
              ...(typeof op.name === 'string' ? { name: op.name } : {}),
              ...(typeof op.intent === 'string' ? { intent: op.intent } : {}),
              ...(Array.isArray(op.requiredStates)
                ? {
                    requiredStates: op.requiredStates as unknown as Action['requiredStates']
                  }
                : {}),
              ...(Array.isArray(op.emittedEvents)
                ? {
                    emittedEvents: op.emittedEvents as unknown as Action['emittedEvents']
                  }
                : {}),
              ...(typeof op.bypassInvariants === 'boolean'
                ? { bypassInvariants: op.bypassInvariants }
                : {}),
              // null/empty string clears the subscription; non-empty sets it.
              ...(op.triggeredByEvent === null || op.triggeredByEvent === ''
                ? { triggeredByEvent: undefined }
                : typeof op.triggeredByEvent === 'string'
                  ? { triggeredByEvent: op.triggeredByEvent as Action['triggeredByEvent'] }
                  : {})
            }
          );
          break;
        case 'remove_action':
          exp = T.removeAction(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId'))
          );
          break;
        case 'move_action':
          exp = T.moveActionBy(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            directionDelta(op)
          );
          break;

        // ── State definition ────────────────────────────────────────────
        case 'add_state_definition': {
          const sharedWith = resolveSharedWith(op, refs);
          const def: StateDefinition = {
            id: asStateDefinitionId(mintId()),
            path: asStatePath(op.path as string),
            type: op.type as StateDefinition['type'],
            defaultValue: op.defaultValue as StateDefinition['defaultValue'],
            ...(Array.isArray(op.enumValues)
              ? { enumValues: op.enumValues as readonly string[] }
              : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(sharedWith ? { sharedWith } : {})
          };
          exp = T.addStateDefinition(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            def
          );
          remember(op.ref, def.id);
          break;
        }
        case 'update_state_definition':
          exp = T.updateStateDefinition(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asStateDefinitionId(op.stateDefinitionId as string),
            {
              ...(typeof op.path === 'string' ? { path: asStatePath(op.path) } : {}),
              ...(typeof op.type === 'string'
                ? { type: op.type as StateDefinition['type'] }
                : {}),
              ...(op.defaultValue !== undefined
                ? { defaultValue: op.defaultValue as StateDefinition['defaultValue'] }
                : {}),
              ...(Array.isArray(op.enumValues)
                ? { enumValues: op.enumValues as readonly string[] }
                : {}),
              ...(typeof op.description === 'string' ? { description: op.description } : {}),
              ...(Array.isArray(op.sharedWith)
                ? {
                    sharedWith:
                      op.sharedWith.length === 0 ? undefined : resolveSharedWith(op, refs)
                  }
                : {})
            }
          );
          break;
        case 'remove_state_definition':
          exp = T.removeStateDefinition(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asStateDefinitionId(op.stateDefinitionId as string)
          );
          break;
        case 'move_state_definition':
          exp = T.moveStateDefinitionBy(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asStateDefinitionId(op.stateDefinitionId as string),
            directionDelta(op)
          );
          break;

        // ── Parameter ───────────────────────────────────────────────────
        case 'add_parameter': {
          const param: Parameter = {
            id: asParameterId(mintId()),
            name: op.name as string,
            type: op.type as Parameter['type'],
            required: op.required as boolean,
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(Array.isArray(op.enumValues)
              ? { enumValues: op.enumValues as readonly string[] }
              : {}),
            ...(op.defaultValue !== undefined
              ? { defaultValue: op.defaultValue as Parameter['defaultValue'] }
              : {}),
            ...(typeof op.bindToStatePath === 'string'
              ? { bindToStatePath: asStatePath(op.bindToStatePath) }
              : {}),
            ...(Array.isArray(op.validations)
              ? { validations: op.validations as unknown as Parameter['validations'] }
              : {})
          };
          exp = T.addParameter(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            param
          );
          remember(op.ref, param.id);
          break;
        }
        case 'update_parameter':
          exp = T.updateParameter(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asParameterId(op.parameterId as string),
            {
              ...(typeof op.name === 'string' ? { name: op.name } : {}),
              ...(typeof op.type === 'string' ? { type: op.type as Parameter['type'] } : {}),
              ...(typeof op.required === 'boolean' ? { required: op.required } : {}),
              ...(typeof op.description === 'string' ? { description: op.description } : {}),
              ...(Array.isArray(op.enumValues)
                ? { enumValues: op.enumValues as readonly string[] }
                : {}),
              ...(op.defaultValue !== undefined
                ? { defaultValue: op.defaultValue as Parameter['defaultValue'] }
                : {}),
              ...('bindToStatePath' in op
                ? {
                    bindToStatePath:
                      op.bindToStatePath === null || op.bindToStatePath === undefined
                        ? undefined
                        : asStatePath(op.bindToStatePath as string)
                  }
                : {}),
              ...(Array.isArray(op.validations)
                ? { validations: op.validations as unknown as Parameter['validations'] }
                : {})
            }
          );
          break;
        case 'remove_parameter':
          exp = T.removeParameter(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asParameterId(op.parameterId as string)
          );
          break;
        case 'move_parameter':
          exp = T.moveParameterBy(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asParameterId(op.parameterId as string),
            directionDelta(op)
          );
          break;

        // ── Rules ───────────────────────────────────────────────────────
        case 'add_action_rule': {
          const rule = buildRule(mintId, (op.rule as Op) ?? op, refs);
          exp = T.addRuleToCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            rule
          );
          remember(op.ref, rule.id);
          break;
        }
        case 'update_action_rule': {
          const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
          const cid = asActionId(resolve(op, refs, 'actionRef', 'actionId'));
          const rid = asRuleId(op.ruleId as string);
          const surface = exp.surfaces.find((s) => s.id === sid);
          const cap = surface?.actions.find((c) => c.id === cid);
          const existing = cap?.rules.find((r) => r.id === rid);
          if (!existing) break;
          const patch = (op.patch as Record<string, unknown> | undefined) ?? {};
          const merged: Rule = {
            ...existing,
            ...(patch.category !== undefined ? { category: patch.category as Rule['category'] } : {}),
            ...(patch.condition !== undefined
              ? { condition: patch.condition as unknown as Rule['condition'] }
              : {}),
            ...(patch.effect !== undefined
              ? {
                  effect: {
                    ...(patch.effect as object),
                    id: asEffectId(
                      ((patch.effect as { id?: string }).id ?? existing.effect.id) as string
                    )
                  } as unknown as Rule['effect']
                }
              : {}),
            ...(typeof patch.description === 'string' ? { description: patch.description } : {})
          };
          exp = T.updateRuleOnCapability(exp, sid, cid, merged);
          break;
        }
        case 'remove_action_rule':
          exp = T.removeRuleFromCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asRuleId(op.ruleId as string)
          );
          break;
        case 'add_surface_rule': {
          const rule = buildRule(mintId, (op.rule as Op) ?? op, refs);
          exp = T.addRuleToSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            rule
          );
          remember(op.ref, rule.id);
          break;
        }
        case 'update_surface_rule': {
          const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
          const rid = asRuleId(op.ruleId as string);
          const surface = exp.surfaces.find((s) => s.id === sid);
          const existing = surface?.rules.find((r) => r.id === rid);
          if (!existing) break;
          const patch = (op.patch as Record<string, unknown> | undefined) ?? {};
          const merged: Rule = {
            ...existing,
            ...(patch.category !== undefined ? { category: patch.category as Rule['category'] } : {}),
            ...(patch.condition !== undefined
              ? { condition: patch.condition as unknown as Rule['condition'] }
              : {}),
            ...(patch.effect !== undefined
              ? {
                  effect: {
                    ...(patch.effect as object),
                    id: asEffectId(
                      ((patch.effect as { id?: string }).id ?? existing.effect.id) as string
                    )
                  } as unknown as Rule['effect']
                }
              : {}),
            ...(typeof patch.description === 'string' ? { description: patch.description } : {})
          };
          exp = T.updateRuleOnSurface(exp, sid, merged);
          break;
        }
        case 'remove_surface_rule':
          exp = T.removeRuleFromSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asRuleId(op.ruleId as string)
          );
          break;

        // ── Effects ─────────────────────────────────────────────────────
        case 'add_effect': {
          const effect = buildEffect(mintId, (op.effect as Record<string, unknown>) ?? {}, refs);
          exp = T.addEffectToCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            effect
          );
          remember(op.ref, effect.id);
          break;
        }
        case 'update_effect':
          exp = T.updateEffectOnCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asEffectId(op.effectId as string),
            (op.patch as Partial<Effect>) ?? {}
          );
          break;
        case 'remove_effect':
          exp = T.removeEffectFromCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asEffectId(op.effectId as string)
          );
          break;

        // ── Invariants ──────────────────────────────────────────────────
        case 'add_action_invariant': {
          const inv = buildInvariantBody(
            (op.invariant as Record<string, unknown>) ?? op,
            mintId
          );
          exp = T.addInvariantToCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            inv
          );
          remember(op.ref, inv.id);
          break;
        }
        case 'update_action_invariant':
          exp = T.updateInvariantOnCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asInvariantId(op.invariantId as string),
            buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
          );
          break;
        case 'remove_action_invariant':
          exp = T.removeInvariantFromCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asInvariantId(op.invariantId as string)
          );
          break;
        case 'add_surface_invariant': {
          const inv = buildInvariantBody(
            (op.invariant as Record<string, unknown>) ?? op,
            mintId
          );
          exp = T.addInvariantToSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            inv
          );
          remember(op.ref, inv.id);
          break;
        }
        case 'update_surface_invariant':
          exp = T.updateInvariantOnSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asInvariantId(op.invariantId as string),
            buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
          );
          break;
        case 'remove_surface_invariant':
          exp = T.removeInvariantFromSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asInvariantId(op.invariantId as string)
          );
          break;

        // ── Feature invariants ──────────────────────────────────────────
        // Cross-surface invariants live at the feature level so a single
        // declaration covers every action, no matter which surface it sits
        // on. Use for accounting / global referential properties.
        case 'add_feature_invariant': {
          const inv = buildInvariantBody(
            (op.invariant as Record<string, unknown>) ?? op,
            mintId
          );
          exp = T.addFeatureInvariant(exp, inv);
          remember(op.ref, inv.id);
          break;
        }
        case 'update_feature_invariant':
          exp = T.updateFeatureInvariant(
            exp,
            asInvariantId(op.invariantId as string),
            buildInvariantPatch((op.patch as Record<string, unknown>) ?? {})
          );
          break;
        case 'remove_feature_invariant':
          exp = T.removeFeatureInvariant(
            exp,
            asInvariantId(op.invariantId as string)
          );
          break;

        // ── Transitions ─────────────────────────────────────────────────
        case 'add_transition': {
          const target = asSurfaceId(resolve(op, refs, 'targetRef', 'target'));
          const trans: Transition = {
            id: asTransitionId(mintId()),
            target,
            ...(typeof op.label === 'string' ? { label: op.label } : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {})
          };
          exp = T.addTransitionToSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            trans
          );
          remember(op.ref, trans.id);
          break;
        }
        case 'update_transition':
          exp = T.updateTransitionOnSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asTransitionId(op.transitionId as string),
            {
              ...('target' in op || 'targetRef' in op
                ? { target: asSurfaceId(resolve(op, refs, 'targetRef', 'target')) }
                : {}),
              ...(typeof op.label === 'string' ? { label: op.label } : {}),
              ...(typeof op.description === 'string' ? { description: op.description } : {})
            }
          );
          break;
        case 'remove_transition':
          exp = T.removeTransitionFromSurface(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asTransitionId(op.transitionId as string)
          );
          break;

        // ── Personas ────────────────────────────────────────────────────
        case 'add_persona': {
          const ovs = buildOverrides(op);
          const persona: Persona = {
            id: asPersonaId(mintId()),
            name: op.name as string,
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            stateOverrides: ovs.state,
            parameterOverrides: ovs.param,
            ...(typeof op.persistAcrossSurfaces === 'boolean'
              ? { persistAcrossSurfaces: op.persistAcrossSurfaces }
              : {})
          };
          exp = T.addPersona(exp, persona);
          remember(op.ref, persona.id);
          break;
        }
        case 'update_persona': {
          const pid = asPersonaId(op.personaId as string);
          const existing = exp.personas.find((p) => p.id === pid);
          if (!existing) break;
          const merged: Persona = {
            ...existing,
            ...(typeof op.name === 'string' ? { name: op.name } : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(Array.isArray(op.stateOverrides)
              ? { stateOverrides: buildOverrides(op).state }
              : {}),
            ...(Array.isArray(op.parameterOverrides)
              ? { parameterOverrides: buildOverrides(op).param }
              : {}),
            ...(typeof op.persistAcrossSurfaces === 'boolean'
              ? { persistAcrossSurfaces: op.persistAcrossSurfaces }
              : {})
          };
          exp = T.updatePersona(exp, merged);
          break;
        }
        case 'remove_persona':
          exp = T.removePersona(exp, asPersonaId(op.personaId as string));
          break;

        // ── Resources ───────────────────────────────────────────────────
        case 'add_resource': {
          // The op's discriminator field `kind = "add_resource"` collides with
          // the resource entity's own `kind` field (e.g. "browser_storage").
          // Two ways to disambiguate:
          //   1. Nest under `resource: {...}`. Preferred, matches add_rule's
          //      `rule: {...}` and add_invariant's `invariant: {...}`.
          //   2. Flat form with `resourceKind` as alias for the resource's kind.
          const r =
            (op.resource as Record<string, unknown> | undefined) ??
            (op as unknown as Record<string, unknown>);
          const resourceKind = (r.resourceKind ??
            (r === (op as unknown as Record<string, unknown>) ? undefined : r.kind)) as
            | Resource['kind']
            | undefined;
          if (!resourceKind) {
            throw new Error(
              'add_resource: resource kind is required. Pass it as `resource:{kind,...}` or `resourceKind`.'
            );
          }
          const resource: Resource = {
            id: asResourceId(mintId()),
            name: r.name as string,
            ...(typeof r.description === 'string' ? { description: r.description } : {}),
            kind: resourceKind,
            provider: r.provider as string,
            scope: r.scope as Resource['scope'],
            ...(typeof r.location === 'string' ? { location: r.location } : {}),
            ...(typeof r.database === 'string' ? { database: r.database } : {}),
            ...(typeof r.container === 'string' ? { container: r.container } : {}),
            ...(typeof r.field === 'string' ? { field: r.field } : {}),
            sensitivity: r.sensitivity as Resource['sensitivity'],
            containsPii: r.containsPii as boolean,
            complianceTags: (r.complianceTags as readonly string[] | undefined) ?? [],
            accessMode: r.accessMode as Resource['accessMode'],
            ...(typeof r.authentication === 'string'
              ? { authentication: r.authentication as Resource['authentication'] }
              : {}),
            ...(typeof r.encryptionAtRest === 'boolean'
              ? { encryptionAtRest: r.encryptionAtRest }
              : {}),
            ...(typeof r.encryptionInTransit === 'boolean'
              ? { encryptionInTransit: r.encryptionInTransit }
              : {}),
            ...(typeof r.retention === 'string' ? { retention: r.retention } : {}),
            ...(typeof r.owner === 'string' ? { owner: r.owner } : {})
          };
          exp = T.addResource(exp, resource);
          remember(op.ref, resource.id);
          break;
        }
        case 'update_resource': {
          const rid = asResourceId(op.resourceId as string);
          const existing = exp.resources.find((r) => r.id === rid);
          if (!existing) break;
          // Same collision rules as add_resource: prefer nested `resource:{}`,
          // and accept `resourceKind` as an alias on the flat form.
          const nested = op.resource as Record<string, unknown> | undefined;
          const src = nested ?? (op as unknown as Record<string, unknown>);
          const kindOverride = nested
            ? (src.kind as Resource['kind'] | undefined)
            : (src.resourceKind as Resource['kind'] | undefined);
          const patch = Object.fromEntries(
            Object.entries(src).filter(
              ([k, v]) =>
                v !== undefined &&
                k !== 'kind' &&
                k !== 'resourceKind' &&
                k !== 'resourceId' &&
                k !== 'resource' &&
                k !== 'ref'
            )
          ) as Partial<Resource>;
          const merged: Resource = {
            ...existing,
            ...patch,
            ...(kindOverride ? { kind: kindOverride } : {})
          };
          exp = T.updateResource(exp, merged);
          break;
        }
        case 'remove_resource':
          exp = T.removeResource(exp, asResourceId(op.resourceId as string));
          break;

        // ── Entity ────────────────────────────────────────────────────────
        case 'add_entity': {
          const fields = (op.fields as readonly Record<string, unknown>[] | undefined) ?? [];
          const resolvedResource = optional(op, 'resourceRef', 'resourceId', refs);
          const data: Entity = {
            id: asEntityId(mintId()),
            namespace: op.namespace as string,
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            fields: fields.map((f) => buildDataField(mintId, f)),
            ...(resolvedResource ? { resourceId: asResourceId(resolvedResource) } : {})
          };
          exp = T.addEntity(exp, data);
          remember(op.ref, data.id);
          break;
        }
        case 'update_entity': {
          const did = asEntityId(op.entityId as string);
          const existing = exp.entities.find((d) => d.id === did);
          if (!existing) break;
          const fields = op.fields as readonly Record<string, unknown>[] | undefined;
          const resolvedResource = optional(op, 'resourceRef', 'resourceId', refs);
          const merged: Entity = {
            ...existing,
            ...(typeof op.namespace === 'string' ? { namespace: op.namespace } : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(fields ? { fields: fields.map((f) => buildDataField(mintId, f)) } : {}),
            ...('resourceId' in op || 'resourceRef' in op
              ? resolvedResource
                ? { resourceId: asResourceId(resolvedResource) }
                : { resourceId: undefined }
              : {})
          };
          exp = T.updateEntity(exp, merged);
          break;
        }
        case 'remove_entity':
          exp = T.removeEntity(exp, asEntityId(op.entityId as string));
          break;
        case 'add_entity_field': {
          const did = asEntityId(resolve(op, refs, 'dataRef', 'entityId'));
          const field = buildDataField(mintId, op as Record<string, unknown>);
          exp = T.addEntityField(exp, did, field);
          remember(op.ref, field.id);
          break;
        }
        case 'update_entity_field':
          exp = T.updateEntityField(
            exp,
            asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
            asEntityFieldId(op.fieldId as string),
            (op.patch as Partial<EntityField>) ?? {}
          );
          break;
        case 'remove_entity_field':
          exp = T.removeEntityField(
            exp,
            asEntityId(resolve(op, refs, 'dataRef', 'entityId')),
            asEntityFieldId(op.fieldId as string)
          );
          break;

        // ── Scenarios ───────────────────────────────────────────────────
        case 'add_scenario': {
          // Shared builder = single source of truth for scenario wire shape.
          // See mcp-server/tools/_entity_builders.ts.
          const resolved = resolveScenarioRefs(op, refs);
          const scenario = buildScenario(resolved, mintId);
          exp = T.addScenarioToCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            scenario
          );
          remember(op.ref, scenario.id);
          break;
        }
        case 'update_scenario': {
          const sid = asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId'));
          const cid = asActionId(resolve(op, refs, 'actionRef', 'actionId'));
          const scid = asScenarioId(op.scenarioId as string);
          const resolved = resolveScenarioRefs(op, refs);
          exp = T.updateScenarioOnCapability(exp, sid, cid, scid, buildScenarioPatch(resolved));
          break;
        }
        case 'remove_scenario':
          exp = T.removeScenarioFromCapability(
            exp,
            asSurfaceId(resolve(op, refs, 'surfaceRef', 'surfaceId')),
            asActionId(resolve(op, refs, 'actionRef', 'actionId')),
            asScenarioId(op.scenarioId as string)
          );
          break;

        // ── Events ──────────────────────────────────────────────────────
        case 'add_event': {
          const payloadRaw = op.payloadSchema as readonly Record<string, unknown>[] | undefined;
          const event: EventDefinition = {
            id: asEventDefinitionId(mintId()),
            name: op.name as EventName,
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(payloadRaw && payloadRaw.length > 0
              ? {
                  payloadSchema: payloadRaw.map(
                    (f) =>
                      ({
                        name: f.name as string,
                        type: f.type as EventPayloadField['type'],
                        required: f.required as boolean,
                        ...(typeof f.description === 'string'
                          ? { description: f.description }
                          : {})
                      }) as EventPayloadField
                  )
                }
              : {})
          };
          exp = T.addEvent(exp, event);
          remember(op.ref, event.id);
          break;
        }
        case 'update_event': {
          const eid = asEventDefinitionId(op.eventId as string);
          const existing = (exp.events ?? []).find((e) => e.id === eid);
          if (!existing) break;
          const payloadRaw = op.payloadSchema as
            | readonly Record<string, unknown>[]
            | undefined;
          const merged: EventDefinition = {
            ...existing,
            ...(typeof op.name === 'string' ? { name: op.name as EventName } : {}),
            ...(typeof op.description === 'string' ? { description: op.description } : {}),
            ...(payloadRaw !== undefined
              ? payloadRaw.length === 0
                ? { payloadSchema: undefined }
                : {
                    payloadSchema: payloadRaw.map(
                      (f) =>
                        ({
                          name: f.name as string,
                          type: f.type as EventPayloadField['type'],
                          required: f.required as boolean,
                          ...(typeof f.description === 'string'
                            ? { description: f.description }
                            : {})
                        }) as EventPayloadField
                    )
                  }
              : {})
          };
          exp = T.updateEvent(exp, merged);
          break;
        }
        case 'remove_event':
          exp = T.removeEvent(exp, asEventDefinitionId(op.eventId as string));
          break;

        default:
          throw new Error(`unknown op kind "${op.kind}"`);
      }
    } catch (e) {
      throw new Error(`op[${i}] (${op.kind}): ${(e as Error).message}`);
    }
  }

  return { next: exp, refs, mintIdToOp };
};

const opSchemaDescription = `Each op: { kind, ref?, ...kindArgs }. ADD ops mint a new id and (when op.ref is set) remember it so later ops in the same batch can address it via *Ref strings. UPDATE ops take the existing id and a patch. REMOVE ops take the id. MOVE ops take { direction: "up"|"down" }. Full per-op-kind schema in the unspa://operations resource. Load it once before authoring a batch. Common gotcha: add_resource's resource entity has its own "kind" field which collides with the op-kind discriminator. Nest under "resource:{kind,...}" or pass "resourceKind" on the flat form.`;

export const registerBatchTool = (deps: ToolDeps): void => {
  const { server, repo, clock, ids, repoContext } = deps;

  server.registerTool(
    'apply_batch',
    {
      description:
        'Apply N add/update/remove/move ops to one Feature in a single atomic load+validate+save. Pass dryRun:true to validate and score without saving. The default dryRun response is a slim summary (~1 KB), pair with verbose:true ONLY when you need the full per-issue maturity report and post-batch feature. Add ops can capture their new id under `ref` so later ops use *Ref instead of *Id; sharedWith also accepts refs created earlier in the same batch. Strongly preferred over many granular calls. See the unspa://operations resource for the full per-op-kind schema reference.',
      inputSchema: {
        featureId: z.string(),
        dryRun: z.boolean().optional(),
        verbose: z.boolean().optional(),
        operations: z
          .array(z.record(z.string(), z.unknown()))
          .describe(opSchemaDescription)
      }
    },
    async ({ featureId, operations, dryRun, verbose }) => {
      try {
        featureId = await expandFeatureId(repo, featureId);
        const current = await repo.get(asFeatureId(featureId));
        if (!current) throw new FeatureNotFoundError(featureId);
        const { next, refs, mintIdToOp } = applyOps(
          current,
          operations as readonly Op[],
          ids
        );
        // Structural validation + reference-integrity (state path declarations,
        // event registry, handler integrity). The granular write tools run
        // both via MutateFeature; apply_batch used to skip the second pass,
        // letting bad handlers and stray emit_event references through.
        const structural = validateFeature(next);
        const refIntegrity = validateReferenceIntegrity(next);
        // Annotate each validation error with the op index that introduced
        // the referenced entity. Scans every long-ish hex id in the error
        // string against the mintIdToOp map and prepends `op[N] (kind):` to
        // the first match. Without this the agent gets errors like
        // "Action 7bfd0b83 invariant 2909e02b: ..." with no way to know
        // which op authored that action, forcing a guess-and-check loop
        // through the whole batch.
        const annotateError = (msg: string): string => {
          // Substring-scan the message for any id we minted during this
          // batch. Regex-by-format would have to know about every id flavor
          // (8-hex, UUID, test fixture's "test-id-N"). Direct membership
          // is format-agnostic and cheap given typical batch sizes.
          // Pick the HIGHEST op index among matches: validator errors often
          // include several ids ("Action X rule Y: ..."); the most recently
          // minted one is usually the proximate cause (the rule, not the
          // parent action the agent already knows is fine).
          let bestOpIdx = -1;
          for (const [mintedId, opIdx] of mintIdToOp) {
            if (msg.includes(mintedId) && opIdx > bestOpIdx) bestOpIdx = opIdx;
          }
          if (bestOpIdx < 0) return msg;
          const op = operations[bestOpIdx] as { kind?: string };
          return `op[${bestOpIdx}] (${op?.kind ?? 'unknown'}): ${msg}`;
        };
        const annotateErrors = (errs: readonly string[]): readonly string[] =>
          errs.map(annotateError);
        const validation: typeof structural = structural.valid && refIntegrity.valid
          ? { valid: true }
          : {
              valid: false,
              errors: [
                ...(structural.valid ? [] : annotateErrors(structural.errors)),
                ...(refIntegrity.valid ? [] : annotateErrors(refIntegrity.errors))
              ]
            };
        if (dryRun) {
          if (verbose) {
            return text({
              ok: validation.valid,
              dryRun: true,
              verbose: true,
              featureId,
              appliedCount: operations.length,
              refs,
              validation,
              maturity: validation.valid ? scoreFeature(next) : null
            });
          }
          return text({
            ok: validation.valid,
            dryRun: true,
            featureId,
            appliedCount: operations.length,
            refs,
            validation,
            maturity: validation.valid ? scoreFeatureTool(next) : null
          });
        }
        if (!validation.valid) {
          // Return a structured result instead of throwing. Previously this
          // path raised FeatureValidationError which the catch block turned
          // into a flat error string, losing the `refs` map (so the agent
          // couldn't see what would have been minted) and the full per-issue
          // list. Returning `{ok:false, validation, refs}` mirrors the
          // dry-run failure shape so the agent can iterate without losing
          // context.
          return text({
            ok: false,
            featureId,
            appliedCount: 0,
            refs,
            validation,
            hint:
              'Validation failed. The batch was NOT applied. Inspect `validation.errors` for per-issue details and `refs` for the ids that would have been minted. Re-run with `dryRun: true` to iterate without committing.'
          });
        }
        const saved: Feature = { ...next, updatedAt: clock() };
        await repo.save(saved);
        const codegen = maybeAutoGenerateTypes(saved, repoContext);
        return text({
          ok: true,
          featureId: saved.id,
          updatedAt: saved.updatedAt,
          appliedCount: operations.length,
          refs,
          ...(codegen
            ? { generatedTypes: { outputPath: codegen.outputPath, stats: codegen.stats } }
            : {})
        });
      } catch (e) {
        if (e instanceof FeatureNotFoundError) return errorText(e.message);
        if (e instanceof FeatureValidationError) {
          return errorText(`${e.message}\n - ${e.errors.join('\n - ')}`);
        }
        return errorText(`Batch failed: ${(e as Error).message}`);
      }
    }
  );
};
