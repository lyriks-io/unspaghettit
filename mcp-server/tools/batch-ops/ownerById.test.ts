import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import {
  VALIDATION,
  validationFeature
} from '../../../src/features/behavior-model/domain/services/DisabledElements.fixture';
import { applyOps } from './applyOps';
import type { Op } from './opHelpers';

/**
 * An op that changes or removes what an action holds may name it by its id
 * alone: the id is unique in the feature, so the surface and the action are
 * found there. Refused only when no action holds it, or several do.
 */

let n = 0;
const mint = () => `id-${n++}`;
const run = (feature: Feature, ops: Op[]) => applyOps(feature, ops, mint).next;
const action = (f: Feature, id: string) => f.surfaces.flatMap((s) => s.actions).find((a) => String(a.id) === id)!;

describe('the owner of a child element found by its id', () => {
  it('updates and removes a scenario named by its id alone', () => {
    const renamed = run(validationFeature(), [{ kind: 'update_scenario', scenarioId: VALIDATION.editorScenario, name: 'An editor validates once' }]);
    expect(action(renamed, VALIDATION.validate).scenarios?.find((s) => String(s.id) === VALIDATION.editorScenario)?.name).toBe('An editor validates once');
    const removed = run(validationFeature(), [{ kind: 'remove_scenario', scenarioId: VALIDATION.viewerScenario }]);
    expect(action(removed, VALIDATION.validate).scenarios?.map((s) => String(s.id))).toEqual([VALIDATION.editorScenario]);
  });

  it('updates and removes an action rule named by its id alone', () => {
    const updated = run(validationFeature(), [{ kind: 'update_action_rule', ruleId: VALIDATION.viewerRule, patch: { description: 'A viewer never validates.' } }]);
    expect(action(updated, VALIDATION.validate).rules[0]?.description).toBe('A viewer never validates.');
    const removed = run(validationFeature(), [{ kind: 'remove_action_rule', ruleId: VALIDATION.reopenRule }]);
    expect(action(removed, VALIDATION.reopen).rules).toEqual([]);
  });

  it('updates and removes an effect named by its id alone', () => {
    const updated = run(validationFeature(), [{ kind: 'update_effect', effectId: 'eff-validated', patch: { description: 'It reads validated now.' } }]);
    expect(action(updated, VALIDATION.validate).effects[0]?.description).toBe('It reads validated now.');
    const removed = run(validationFeature(), [{ kind: 'remove_effect', effectId: 'eff-reopened' }]);
    expect(action(removed, VALIDATION.reopen).effects).toEqual([]);
  });

  it('keeps the direction of an effect that lives on a rule', () => {
    expect(() => run(validationFeature(), [{ kind: 'update_effect', effectId: 'eff-viewer-block', patch: { description: 'x' } }])).toThrow(/update_action_rule/);
  });

  it('updates, moves and removes a parameter named by its id alone', () => {
    const withParams = run(validationFeature(), [
      { kind: 'add_parameter', surfaceId: VALIDATION.surface, actionId: VALIDATION.validate, ref: 'p1', name: 'note', type: 'string', required: false, description: 'A note.' },
      { kind: 'add_parameter', surfaceId: VALIDATION.surface, actionId: VALIDATION.validate, ref: 'p2', name: 'tag', type: 'string', required: false, description: 'A tag.' }
    ]);
    const [p1, p2] = action(withParams, VALIDATION.validate).parameters.map((p) => String(p.id));
    const changed = run(withParams, [
      { kind: 'update_parameter', parameterId: p1!, description: 'A short note.' },
      { kind: 'move_parameter', parameterId: p2!, direction: 'up' },
      { kind: 'remove_parameter', parameterId: p1! }
    ]);
    expect(action(changed, VALIDATION.validate).parameters.map((p) => String(p.id))).toEqual([p2]);
  });

  it('still takes a surface and an action when they are given', () => {
    const renamed = run(validationFeature(), [{ kind: 'update_scenario', surfaceId: VALIDATION.surface, actionId: VALIDATION.validate, scenarioId: VALIDATION.editorScenario, name: 'Named fully' }]);
    expect(action(renamed, VALIDATION.validate).scenarios?.[0]?.name).toBe('Named fully');
  });

  it('refuses an id no action holds, naming it', () => {
    expect(() => run(validationFeature(), [{ kind: 'update_scenario', scenarioId: 'scn-ghost', name: 'x' }])).toThrow('no action of this feature holds the scenario "scn-ghost"');
    expect(() => run(validationFeature(), [{ kind: 'remove_action_invariant', invariantId: 'inv-ghost' }])).toThrow('inv-ghost');
  });

  it('refuses an id several actions hold, naming the candidates', () => {
    const twice = validationFeature();
    const copy = { ...action(twice, VALIDATION.validate).scenarios![0]! };
    const feature: Feature = {
      ...twice,
      surfaces: twice.surfaces.map((s) => ({
        ...s,
        actions: s.actions.map((a) => (String(a.id) === VALIDATION.reopen ? { ...a, scenarios: [...(a.scenarios ?? []), copy] } : a))
      }))
    };
    expect(() => run(feature, [{ kind: 'remove_scenario', scenarioId: VALIDATION.editorScenario }])).toThrow(
      /held by several actions: "Validate an element" \(surfaceId srf-element, actionId act-validate\), "Reopen the element" \(surfaceId srf-element, actionId act-reopen\)/
    );
  });
});
