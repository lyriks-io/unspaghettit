import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Scenario } from '$features/behavior-model/domain/entities/Scenario';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { stable } from '$features/behavior-model/domain/services/FeatureElementVersions';

/**
 * Which scenarios a change can have moved.
 *
 * A write that stays inside some actions (their rules, effects, parameters,
 * invariants, transitions, scenarios) can only move the scenarios that exercise
 * those actions, so only they need to run again. A write to anything the whole
 * feature simulates against (a state definition, a surface or feature
 * invariant, a surface rule, a constant, a value set, a persona, an event, an
 * entity) can move any scenario, and the honest answer is to run them all.
 *
 * Derived from the two features rather than from the operations that led from
 * one to the other: a diff cannot miss an op kind added later, and an edit that
 * a later op in the same batch undid is correctly nobody's business.
 */
export type ScenarioScope =
  | { readonly scope: 'feature' }
  | { readonly scope: 'touched'; readonly actionIds: ReadonlySet<string> };

/**
 * What every scenario of the feature runs against, whichever action it tests.
 * Deliberately NOT here: prose and organisation (names, descriptions, tags,
 * acceptance criteria, reachability goals, resources, dependencies, the surface
 * tree) and surface-level transitions, which document navigation and are never
 * read by the simulator. A surface that carries none of these lists is left out
 * so that adding an empty surface, then actions inside it, stays a touched-only
 * change.
 */
const sharedGround = (feature: Feature): string =>
  stable({
    personas: feature.personas ?? [],
    personaRefs: feature.personaRefs ?? [],
    entities: feature.entities ?? [],
    entityRefs: feature.entityRefs ?? [],
    valueSets: feature.valueSets ?? [],
    constants: feature.constants ?? [],
    featureInvariants: feature.featureInvariants ?? [],
    events: feature.events ?? [],
    surfaces: (feature.surfaces ?? [])
      .map((surface: Surface) => ({
        id: surface.id,
        stateDefinitions: surface.stateDefinitions ?? [],
        rules: surface.rules ?? [],
        invariants: surface.invariants ?? []
      }))
      .filter(
        (s) => s.stateDefinitions.length + s.rules.length + s.invariants.length > 0
      )
  });

const actionsById = (feature: Feature): ReadonlyMap<string, Action> =>
  new Map(
    (feature.surfaces ?? []).flatMap((surface) =>
      (surface.actions ?? []).map((action) => [String(action.id), action] as const)
    )
  );

/**
 * The scope of the scenarios to run again after `before` became `after`.
 *
 * An action counts as touched when it is new or when anything it owns differs,
 * order included (moving a rule changes which one blocks first). An event
 * handler is wider than itself: it runs inside the scenarios of whichever
 * action emits its event, so touching one widens the scope to the feature.
 */
export const scenarioScopeOfChange = (before: Feature, after: Feature): ScenarioScope => {
  if (sharedGround(before) !== sharedGround(after)) return { scope: 'feature' };

  const previous = actionsById(before);
  const current = actionsById(after);
  const touched = new Set<string>();
  for (const [id, action] of current) {
    const was = previous.get(id);
    if (was !== undefined && stable(was) === stable(action)) continue;
    if (action.triggeredByEvent !== undefined || was?.triggeredByEvent !== undefined) {
      return { scope: 'feature' };
    }
    touched.add(id);
  }
  // A removed handler no longer reacts inside its emitters' scenarios.
  for (const [id, was] of previous) {
    if (!current.has(id) && was.triggeredByEvent !== undefined) {
      return { scope: 'feature' };
    }
  }
  return { scope: 'touched', actionIds: touched };
};

/**
 * True when the scenario exercises one of the touched actions: it tests one, or
 * it replays one as a step on the way to the action it tests.
 */
export const scenarioExercises = (
  actionIds: ReadonlySet<string>,
  action: Action,
  scenario: Scenario
): boolean =>
  actionIds.has(String(action.id)) ||
  (scenario.steps ?? []).some((step) => actionIds.has(String(step.actionId)));
