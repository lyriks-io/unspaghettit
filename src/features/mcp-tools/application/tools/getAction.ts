import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { DevContext } from '$features/behavior-model/domain/value-objects/DevContext';
import { resolveDevContext } from '$features/behavior-model/domain/value-objects/DevContext';
import type {
  ActionId,
  FeatureId,
  SurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import type { StatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { flattenLeafConditions } from '$features/behavior-model/domain/value-objects/RuleCondition';

export type FocusedAction = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly surfaceId: SurfaceId;
  readonly surfaceName: string;
  readonly action: Action;
  readonly linkedStateDefinitions: readonly StateDefinition[];
  readonly enclosingInvariants: readonly Invariant[];
  readonly devContext?: DevContext;
};

const collectTouchedPaths = (action: Action): ReadonlySet<StatePath> => {
  const paths = new Set<StatePath>();
  for (const required of action.requiredStates) paths.add(required);
  for (const param of action.parameters) {
    if (param.bindToStatePath) paths.add(param.bindToStatePath);
  }
  for (const rule of action.rules) {
    // Composite conditions (`all`/`any`/`not`) may name several state paths;
    // unconditional rules name zero. flattenLeafConditions yields each leaf
    // {left, operator, right} so we collect every path touched.
    for (const leaf of flattenLeafConditions(rule.condition)) paths.add(leaf.left);
    if (rule.effect.type === 'set_state') paths.add(rule.effect.path);
  }
  for (const effect of action.effects) {
    if (effect.type === 'set_state') paths.add(effect.path);
  }
  for (const invariant of action.invariants) {
    for (const leaf of flattenLeafConditions(invariant.condition)) paths.add(leaf.left);
  }
  return paths;
};

export const getActionTool = (
  feature: Feature,
  actionId: ActionId
): FocusedAction | null => {
  for (const surface of feature.surfaces) {
    const action = surface.actions.find((c) => c.id === actionId);
    if (!action) continue;

    const touched = collectTouchedPaths(action);
    const linkedStateDefinitions = surface.stateDefinitions.filter((d) => touched.has(d.path));
    const enclosingInvariants = surface.invariants.filter((inv) =>
      flattenLeafConditions(inv.condition).some((leaf) => touched.has(leaf.left))
    );
    const devContext = resolveDevContext(feature.devContext);

    return {
      featureId: feature.id,
      featureName: feature.name,
      surfaceId: surface.id,
      surfaceName: surface.name,
      action,
      linkedStateDefinitions,
      enclosingInvariants,
      ...(devContext ? { devContext } : {})
    };
  }
  return null;
};

/**
 * Per-action slice returned in a bulk fetch. Same data as FocusedAction
 * minus the duplicated state def / invariant / devContext blocks. Those move
 * to the top level so N actions don't pay N× for the same metadata.
 */
export type BulkActionEntry = {
  readonly actionId: ActionId;
  readonly surfaceId: SurfaceId;
  readonly surfaceName: string;
  readonly action: Action;
  /** Ids of state defs in the aggregated `linkedStateDefinitions[]` that this action touches. */
  readonly linkedStateDefinitionIds: readonly string[];
  /** Ids of invariants in the aggregated `enclosingInvariants[]` that enclose this action. */
  readonly enclosingInvariantIds: readonly string[];
};

export type BulkActionsOutput = {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly actions: readonly BulkActionEntry[];
  readonly notFound: readonly ActionId[];
  /** Union of every state def touched by any returned action, deduped by id. */
  readonly linkedStateDefinitions: readonly StateDefinition[];
  /** Union of every enclosing invariant across the returned actions, deduped by id. */
  readonly enclosingInvariants: readonly Invariant[];
  readonly devContext?: DevContext;
};

/**
 * Bulk variant of getActionTool. Returns each requested action with
 * the shared state-def / invariant / devContext blocks pulled out and deduped
 * at the top level. So fetching N actions on one surface costs roughly
 * one action's worth of metadata instead of N×.
 */
export const getActionsTool = (
  feature: Feature,
  actionIds: readonly ActionId[]
): BulkActionsOutput => {
  const entries: BulkActionEntry[] = [];
  const notFound: ActionId[] = [];
  const stateDefsById = new Map<string, StateDefinition>();
  const invariantsById = new Map<string, Invariant>();

  for (const id of actionIds) {
    let found = false;
    for (const surface of feature.surfaces) {
      const action = surface.actions.find((c) => c.id === id);
      if (!action) continue;
      found = true;
      const touched = collectTouchedPaths(action);
      const myStateDefs = surface.stateDefinitions.filter((d) => touched.has(d.path));
      const myInvariants = surface.invariants.filter((inv) =>
        flattenLeafConditions(inv.condition).some((leaf) => touched.has(leaf.left))
      );
      for (const sd of myStateDefs) stateDefsById.set(String(sd.id), sd);
      for (const inv of myInvariants) invariantsById.set(String(inv.id), inv);
      entries.push({
        actionId: id,
        surfaceId: surface.id,
        surfaceName: surface.name,
        action,
        linkedStateDefinitionIds: myStateDefs.map((d) => String(d.id)),
        enclosingInvariantIds: myInvariants.map((inv) => String(inv.id))
      });
      break;
    }
    if (!found) notFound.push(id);
  }

  const devContext = resolveDevContext(feature.devContext);

  return {
    featureId: feature.id,
    featureName: feature.name,
    actions: entries,
    notFound,
    linkedStateDefinitions: [...stateDefsById.values()],
    enclosingInvariants: [...invariantsById.values()],
    ...(devContext ? { devContext } : {})
  };
};
