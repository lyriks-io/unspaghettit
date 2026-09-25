import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import { applyFeatureLevelOps } from './featureLevelOps';
import { applyRuleInvariantOps } from './ruleInvariantOps';
import { applyScenarioEventOps } from './scenarioEventOps';
import { applyStateParamOps } from './stateParamOps';
import { applySurfaceActionOps } from './surfaceActionOps';
import type { Op, OpContext, Refs } from './opHelpers';

/**
 * One element an add op created. `kind` is the op kind without its `add_`
 * prefix (`action`, `action_rule`, `state_definition`, ...). `key` is the
 * `.unspa.json` index key the element is mapped under, for the kinds the
 * index knows; a state also carries its `path`, since that is what its key
 * is made of.
 */
export type CreatedElement = {
  readonly op: number;
  readonly kind: string;
  readonly id: string;
  readonly path?: string;
  readonly key?: string;
};

/** A state definition whose path the batch changed, as index keys. */
export type RenamedState = {
  readonly from: string;
  readonly to: string;
  readonly stateDefinitionId: string;
  readonly surfaceId: string;
};

// The index key prefix per add op kind whose element is keyed by its id. States
// and events are keyed by path and name, so they are resolved on the feature.
const ID_KEY_PREFIX: Readonly<Record<string, string>> = {
  add_surface: 'surface',
  add_action: 'action',
  add_action_rule: 'rule',
  add_surface_rule: 'surface_rule',
  add_action_invariant: 'invariant',
  add_feature_invariant: 'invariant',
  add_surface_invariant: 'surface_invariant',
  add_transition: 'transition',
  add_entity: 'entity',
  add_acceptance_criterion: 'criterion'
};

const findStateDefinition = (
  feature: Feature,
  id: string
): { readonly path: string; readonly surfaceId: string } | null => {
  for (const surface of feature.surfaces) {
    const def = surface.stateDefinitions.find((d) => String(d.id) === id);
    if (def) return { path: String(def.path), surfaceId: String(surface.id) };
  }
  return null;
};

/** What an add op created, keyed the way the index keys it when it can be. */
const describeCreated = (op: Op, index: number, id: string, feature: Feature): CreatedElement => {
  const kind = op.kind.replace(/^add_/, '');
  if (op.kind === 'add_state_definition') {
    const found = findStateDefinition(feature, id);
    return found
      ? { op: index, kind, id, path: found.path, key: `state:${found.path}` }
      : { op: index, kind, id };
  }
  if (op.kind === 'add_event') {
    const event = (feature.events ?? []).find((e) => String(e.id) === id);
    return event ? { op: index, kind, id, key: `event:${String(event.name)}` } : { op: index, kind, id };
  }
  const prefix = ID_KEY_PREFIX[op.kind];
  return prefix ? { op: index, kind, id, key: `${prefix}:${id}` } : { op: index, kind, id };
};

// Family handlers, chained in the same order the original single switch
// tested op kinds. Each handler returns the next Feature when it recognized
// op.kind and null when the op belongs to another family, so an op falls
// through the chain until exactly one family claims it.
const familyHandlers: readonly ((op: Op, ctx: OpContext) => Feature | null)[] = [
  applySurfaceActionOps,
  applyStateParamOps,
  applyRuleInvariantOps,
  applyFeatureLevelOps,
  applyScenarioEventOps
];

// The primary target id key per remove op, so validation errors that mention a
// just-removed id can be attributed to the op that removed it. Structural keys
// (the parent surfaceId of a remove_action, say) are deliberately NOT tracked;
// they would mis-attribute errors that merely mention the parent.
const REMOVE_TARGET_KEYS: Readonly<Record<string, string>> = {
  remove_surface: 'surfaceId',
  remove_action: 'actionId',
  remove_action_rule: 'ruleId',
  remove_surface_rule: 'ruleId',
  remove_effect: 'effectId',
  remove_action_invariant: 'invariantId',
  remove_surface_invariant: 'invariantId',
  remove_feature_invariant: 'invariantId',
  remove_reachability_goal: 'goalId',
  remove_acceptance_criterion: 'criterionId',
  remove_scenario: 'scenarioId',
  remove_event: 'eventId',
  remove_transition: 'transitionId',
  remove_persona: 'personaId',
  remove_value_set: 'valueSetId',
  remove_constant: 'constantId',
  remove_resource: 'resourceId',
  remove_dependency: 'dependencyId',
  remove_state_definition: 'stateDefinitionId',
  remove_parameter: 'parameterId',
  remove_entity: 'entityId',
  remove_entity_field: 'fieldId',
  remove_action_outcome: 'outcomeId'
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
 * to fix rather than scanning the whole batch. `removedIdToOp` is the same
 * map for the ids remove ops targeted, so an error like "transition targets
 * unknown surface X" names the remove_surface op that orphaned it.
 *
 * `created` lists what every add op created, whether or not it carried a
 * `ref`: `refs` alone left an agent re-reading the whole feature to learn the
 * ids it needed for its index entries. `renamed` lists the state definitions
 * whose path changed, as index keys, because an index still holding the old
 * `state:<path>` key otherwise learns it only as an unexplained orphan.
 */
export const applyOps = (start: Feature, ops: readonly Op[], rawMintId: () => string): {
  next: Feature;
  refs: Refs;
  created: readonly CreatedElement[];
  renamed: readonly RenamedState[];
  mintIdToOp: ReadonlyMap<string, number>;
  removedIdToOp: ReadonlyMap<string, number>;
} => {
  let exp = start;
  const refs: Refs = {};
  const created: CreatedElement[] = [];
  const mintIdToOp = new Map<string, number>();
  const removedIdToOp = new Map<string, number>();
  // Every add op calls remember exactly once with the id of what it created,
  // ref or not, so this is where the created list is gathered. The element is
  // described once the op has run, when its path or name is on the feature.
  const createdByOp: { id: string | null } = { id: null };
  const remember = (ref: unknown, id: string) => {
    if (typeof ref === 'string' && ref.length > 0) refs[ref] = id;
    createdByOp.id = id;
  };
  // First path seen and latest path, per renamed state definition. A state
  // renamed twice in one batch is one rename; renamed back, it is none.
  const renames = new Map<string, { from: string; to: string; surfaceId: string }>();

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
    const removeTargetKey = REMOVE_TARGET_KEYS[op.kind];
    if (removeTargetKey) {
      const target = op[removeTargetKey];
      if (typeof target === 'string' && target.length > 0) removedIdToOp.set(target, i);
    }
    const renamedId =
      op.kind === 'update_state_definition' && typeof op.stateDefinitionId === 'string'
        ? op.stateDefinitionId
        : null;
    const before = renamedId !== null ? findStateDefinition(exp, renamedId) : null;
    createdByOp.id = null;
    try {
      const ctx: OpContext = { feature: exp, refs, mintId, remember };
      let handled: Feature | null = null;
      for (const handler of familyHandlers) {
        handled = handler(op, ctx);
        if (handled !== null) break;
      }
      if (handled === null) throw new Error(`unknown op kind "${op.kind}"`);
      exp = handled;
    } catch (e) {
      throw new Error(`op[${i}] (${op.kind}): ${(e as Error).message}`);
    }
    if (createdByOp.id !== null) created.push(describeCreated(op, i, createdByOp.id, exp));
    if (renamedId !== null && before) {
      const after = findStateDefinition(exp, renamedId);
      if (after && after.path !== before.path) {
        const earlier = renames.get(renamedId);
        renames.set(renamedId, {
          from: earlier?.from ?? before.path,
          to: after.path,
          surfaceId: after.surfaceId
        });
      }
    }
  }

  // A state minted in this batch has no index entry to migrate, and one the
  // batch removed afterwards has nothing to migrate to.
  const renamed: RenamedState[] = [];
  for (const [id, r] of renames) {
    if (mintIdToOp.has(id) || r.from === r.to) continue;
    const now = findStateDefinition(exp, id);
    if (!now) continue;
    renamed.push({
      from: `state:${r.from}`,
      to: `state:${now.path}`,
      stateDefinitionId: id,
      surfaceId: now.surfaceId
    });
  }

  return { next: exp, refs, created, renamed, mintIdToOp, removedIdToOp };
};
