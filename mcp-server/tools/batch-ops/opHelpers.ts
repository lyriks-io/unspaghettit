import type { EntityField } from '../../../src/features/behavior-model/domain/entities/Entity';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Persona } from '../../../src/features/behavior-model/domain/entities/Persona';
import type { Rule } from '../../../src/features/behavior-model/domain/entities/Rule';
import type { StateDefinition } from '../../../src/features/behavior-model/domain/entities/StateDefinition';
import type { Effect } from '../../../src/features/behavior-model/domain/value-objects/Effect';
import {
  asEffectId,
  asEntityFieldId,
  asRuleId,
  asSurfaceId,
  asValueSetId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '../../../src/features/behavior-model/domain/value-objects/StatePath';

export type Op = Record<string, unknown> & { readonly kind: string };
export type Refs = Record<string, string>;

/**
 * Minimal context threaded through the per-family op handlers. Carries the
 * running feature plus the batch-wide refs map and the tracking mintId and
 * remember closures owned by applyOps.
 */
export type OpContext = {
  readonly feature: Feature;
  readonly refs: Refs;
  readonly mintId: () => string;
  readonly remember: (ref: unknown, id: string) => void;
  /** The batch's clock, for what an op stamps (when an element was disabled). */
  readonly now?: () => string;
};

const get = <K extends string>(op: Op, key: K): unknown => op[key];

/**
 * Update ops accept their editable fields either flat on the op (the original
 * engine contract) or nested under `patch` (the spelling half the callers use,
 * the platform facade included). Both used to half-work: flat ops silently
 * ignored `patch` and patch ops silently ignored flat fields, producing an
 * empty patch that saved nothing while acking ok:true. Merging `patch` over
 * the op lets both spellings reach the field picks; the callers keep reading
 * structural keys (ids, refs) off the original op.
 */
export const withPatch = (op: Op): Op => {
  const patch = op.patch;
  if (patch === undefined) return op;
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new Error(`${op.kind}: "patch" must be an object`);
  }
  return { ...op, ...(patch as Record<string, unknown>), kind: op.kind };
};

/** A copy of the op without its structural keys, for open-ended patch shapes. */
export const flatFields = (
  op: Op,
  structuralKeys: readonly string[]
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(op).filter(([k]) => k !== 'patch' && !structuralKeys.includes(k))
  );

/**
 * Refuse an update whose computed patch is empty. An empty patch was the other
 * face of the silent-no-op bug: the save "succeeded" while changing nothing,
 * which taught agents that update_* was broken and pushed them into
 * remove+add churn.
 */
export const requireSomeChange = (
  op: Op,
  patch: Record<string, unknown>,
  accepted: readonly string[]
): void => {
  if (Object.keys(patch).length > 0) return;
  throw new Error(
    `${op.kind}: nothing to update. Pass at least one of: ${accepted.join(', ')} (flat on the op or under "patch").`
  );
};

/**
 * Loud lookup failure for update ops, mirroring transforms/internal.mustMap:
 * an update whose target id does not resolve must never ack success.
 */
export const notFoundInOp = (op: Op, kind: string, id: unknown, where?: string): Error =>
  new Error(
    `${op.kind}: ${kind} "${String(id)}" not found${where ? ` ${where}` : ''}. Updates never no-op silently; re-read the ids with get_feature and retry.`
  );

export const resolve = (op: Op, refs: Refs, refKey: string, idKey: string): string => {
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

export const optional = (op: Op, refKey: string, idKey: string, refs: Refs): string | undefined => {
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
export const resolveScenarioRefs = (op: Op, refs: Refs): Op => {
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

  // A multi-step scenario addresses one action per step, and those actions are
  // routinely minted by the SAME batch. Without this, writing the flow meant a
  // second batch just to copy the ids back in, so `steps[]` takes `actionRef` /
  // `surfaceRef` exactly like every other op.
  const steps = get(op, 'steps');
  if (Array.isArray(steps)) {
    next = { ...next, steps: steps.map((step) => resolveStepRefs(op, step, refs)) };
  }
  return next;
};

const resolveStepRefs = (op: Op, step: unknown, refs: Refs): unknown => {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
  const raw = step as Record<string, unknown>;
  let out = raw;
  for (const [refKey, idKey] of [
    ['actionRef', 'actionId'],
    ['surfaceRef', 'surfaceId']
  ] as const) {
    const ref = raw[refKey];
    if (typeof ref !== 'string' || ref.length === 0) continue;
    if (raw[idKey] !== undefined) continue;
    const resolved = refs[ref];
    if (!resolved) throw new Error(`${op.kind}: unknown steps[].${refKey} "${ref}"`);
    out = { ...out, [idKey]: resolved };
  }
  if (out === raw) return raw;
  delete out.actionRef;
  delete out.surfaceRef;
  return out;
};

export const resolveSharedWith = (
  op: Op,
  refs: Refs
): StateDefinition['sharedWith'] | undefined => {
  if (!Array.isArray(op.sharedWith) || op.sharedWith.length === 0) return undefined;
  return (op.sharedWith as readonly string[]).map((s) =>
    asSurfaceId(resolveIdOrRefValue(s, refs))
  ) as StateDefinition['sharedWith'];
};

export const directionDelta = (op: Op): -1 | 1 => {
  const d = get(op, 'direction');
  if (d === 'up') return -1;
  if (d === 'down') return 1;
  throw new Error(`${op.kind}: direction must be "up" or "down"`);
};

export const buildEffect = (
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

export const buildRule = (mintId: () => string, raw: Op, refs: Refs): Rule => {
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

export const buildDataField = (mintId: () => string, raw: Record<string, unknown>): EntityField => {
  const fields = raw.fields as readonly Record<string, unknown>[] | undefined;
  const items = raw.items as Record<string, unknown> | undefined;
  return {
    id: asEntityFieldId(mintId()),
    name: raw.name as string,
    type: raw.type as EntityField['type'],
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw.required === 'boolean' ? { required: raw.required } : {}),
    ...(Array.isArray(raw.enumValues) ? { enumValues: raw.enumValues as readonly string[] } : {}),
    ...(typeof raw.valueSetId === 'string' ? { valueSetId: asValueSetId(raw.valueSetId) } : {}),
    ...(typeof raw.path === 'string' ? { path: asStatePath(raw.path) } : {}),
    ...(fields ? { fields: fields.map((f) => buildDataField(mintId, f)) } : {}),
    ...(items ? { items: buildDataField(mintId, items) } : {})
  };
};

export const buildOverrides = (
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

/** The ops that address an element an action holds, by the key of its id, where it lives and what it is called. */
const OWNED_BY_ACTION: Readonly<Record<string, { readonly idKey: string; readonly what: string }>> = {
  update_scenario: { idKey: 'scenarioId', what: 'scenario' },
  remove_scenario: { idKey: 'scenarioId', what: 'scenario' },
  update_action_rule: { idKey: 'ruleId', what: 'rule' },
  remove_action_rule: { idKey: 'ruleId', what: 'rule' },
  update_action_invariant: { idKey: 'invariantId', what: 'invariant' },
  remove_action_invariant: { idKey: 'invariantId', what: 'invariant' },
  update_parameter: { idKey: 'parameterId', what: 'parameter' },
  remove_parameter: { idKey: 'parameterId', what: 'parameter' },
  move_parameter: { idKey: 'parameterId', what: 'parameter' },
  update_effect: { idKey: 'effectId', what: 'effect' },
  remove_effect: { idKey: 'effectId', what: 'effect' }
};

type ActionLike = Feature['surfaces'][number]['actions'][number];

const idsIn = (list: unknown): readonly string[] =>
  Array.isArray(list) ? list.map((e) => String((e as { id?: unknown })?.id ?? '')) : [];

/** Whether the action holds the element this op names, where the op addresses it. */
const holds = (action: ActionLike, op: Op, idKey: string, id: string): boolean => {
  switch (idKey) {
    case 'scenarioId':
      return idsIn(action.scenarios).includes(id);
    case 'ruleId':
      return idsIn(action.rules).includes(id);
    case 'invariantId':
      return idsIn(action.invariants).includes(id);
    case 'parameterId':
      return idsIn(action.parameters).includes(id);
    default:
      // An effect: the action's own (or its blocked-attempt ones), or one its
      // rules or outcomes hold, which the op then refuses with its direction.
      return (
        idsIn(op.onBlocked ? action.onBlockedEffects : action.effects).includes(id) ||
        action.rules.some((r) => String((r.effect as { id?: unknown } | undefined)?.id ?? '') === id) ||
        (action.outcomes ?? []).some((o) => idsIn(o.effects).includes(id))
      );
  }
};

/**
 * An op that names the element of an action by its id alone: the surface and
 * the action that hold it are found in the feature, since ids are unique there.
 * Given, surfaceId and actionId still narrow the search (a ref resolves first).
 * Refused only when no action holds the id, or several do, naming them.
 */
export const withActionOwner = (op: Op, feature: Feature, refs: Refs): Op => {
  const owned = OWNED_BY_ACTION[op.kind];
  if (!owned) return op;
  const named = (ref: string, id: string) =>
    (typeof op[ref] === 'string' && op[ref] !== '') || (typeof op[id] === 'string' && op[id] !== '');
  const hasSurface = named('surfaceRef', 'surfaceId');
  const hasAction = named('actionRef', 'actionId');
  if (hasSurface && hasAction) return op;
  const id = op[owned.idKey];
  if (typeof id !== 'string' || id === '') return op;
  const surfaceId = hasSurface ? resolve(op, refs, 'surfaceRef', 'surfaceId') : null;
  const actionId = hasAction ? resolve(op, refs, 'actionRef', 'actionId') : null;
  const owners: { surfaceId: string; actionId: string; actionName: string }[] = [];
  for (const surface of feature.surfaces) {
    if (surfaceId !== null && String(surface.id) !== surfaceId) continue;
    for (const action of surface.actions) {
      if (actionId !== null && String(action.id) !== actionId) continue;
      if (holds(action, op, owned.idKey, id))
        owners.push({ surfaceId: String(surface.id), actionId: String(action.id), actionName: action.name });
    }
  }
  if (owners.length === 0) {
    throw new Error(`${op.kind}: no action of this feature holds the ${owned.what} "${id}"`);
  }
  if (owners.length > 1) {
    const named = owners.map((o) => `"${o.actionName}" (surfaceId ${o.surfaceId}, actionId ${o.actionId})`).join(', ');
    throw new Error(
      `${op.kind}: the ${owned.what} "${id}" is held by several actions: ${named}. Name the one meant with surfaceId and actionId.`
    );
  }
  const [owner] = owners;
  return { ...op, surfaceId: owner!.surfaceId, actionId: owner!.actionId };
};
