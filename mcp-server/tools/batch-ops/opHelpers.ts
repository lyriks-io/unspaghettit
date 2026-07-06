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
  asSurfaceId
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
};

const get = <K extends string>(op: Op, key: K): unknown => op[key];

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
  return next;
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
