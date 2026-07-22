import { describe, expect, it } from 'vitest';
import {
  buildAcceptanceCriterion,
  buildAcceptanceCriterionPatch,
  buildInvariant,
  buildInvariantPatch,
  buildScenario,
  buildScenarioBody,
  buildScenarioPatch
} from './_entity_builders';

const ids = (() => {
  let n = 0;
  return () => `id-${++n}`;
})();

describe('_entity_builders.buildScenario', () => {
  it('forwards expectedTransition through (the field that bit us)', () => {
    const sc = buildScenario(
      {
        name: 'Routes to Auth',
        stateOverrides: [],
        parameterOverrides: [],
        expectedStatus: 'success',
        expectedTransition: 'surf_auth'
      },
      ids
    );
    expect(sc.expectedTransition).toBe('surf_auth');
    expect(sc.expectedStatus).toBe('success');
    expect(sc.name).toBe('Routes to Auth');
  });

  it('accepts expectedTransition: null as a real assertion ("no transition fires")', () => {
    const sc = buildScenario(
      { name: 'stays put', stateOverrides: [], parameterOverrides: [], expectedTransition: null },
      ids
    );
    expect(sc.expectedTransition).toBeNull();
  });

  it('omits expectedTransition when the caller did not send one', () => {
    const sc = buildScenario(
      { name: 'no routing check', stateOverrides: [], parameterOverrides: [] },
      ids
    );
    expect('expectedTransition' in sc).toBe(false);
  });

  it('forwards personaId through so run_all_scenarios can apply the persona baseline', () => {
    const sc = buildScenario(
      { name: 'as premium', personaId: 'persona_1', stateOverrides: [], parameterOverrides: [] },
      ids
    );
    expect(sc.personaId).toBe('persona_1');
  });

  it('drops empty expectedAssertions arrays from the body', () => {
    const body = buildScenarioBody({
      name: 'x',
      stateOverrides: [],
      parameterOverrides: [],
      expectedAssertions: []
    });
    expect('expectedAssertions' in body).toBe(false);
  });

  it('maps assertion paths and operators through', () => {
    const sc = buildScenario(
      {
        name: 'with assertions',
        stateOverrides: [],
        parameterOverrides: [],
        expectedAssertions: [
          { path: 'cart.count', operator: 'equals', value: 3 },
          { path: 'cart.loading', operator: 'is_true', description: 'must be loading' }
        ]
      },
      ids
    );
    expect(sc.expectedAssertions).toHaveLength(2);
    expect(sc.expectedAssertions?.[0]?.operator).toBe('equals');
    expect(sc.expectedAssertions?.[1]?.description).toBe('must be loading');
  });
});

describe('_entity_builders.buildScenarioPatch', () => {
  it('forwards expectedTransition through in updates', () => {
    const patch = buildScenarioPatch({ expectedTransition: 'surf_x' });
    expect(patch.expectedTransition).toBe('surf_x');
  });

  it('can clear personaId in updates', () => {
    const patch = buildScenarioPatch({ personaId: null });
    expect('personaId' in patch).toBe(true);
    expect(patch.personaId).toBeUndefined();
  });

  it('clears expectedAssertions with an empty array', () => {
    const patch = buildScenarioPatch({ expectedAssertions: [] });
    expect('expectedAssertions' in patch).toBe(true);
    expect(patch.expectedAssertions).toBeUndefined();
  });

  it('omits keys the caller did not send (so untouched fields keep current value)', () => {
    const patch = buildScenarioPatch({ name: 'renamed' });
    expect(Object.keys(patch)).toEqual(['name']);
  });
});

describe('_entity_builders.buildInvariant + buildInvariantPatch', () => {
  it('builds an invariant with all required fields plus description when present', () => {
    const inv = buildInvariant(
      { name: 'discount within bounds', condition: { left: 'x', operator: 'is_true' }, message: 'OK', description: 'why' },
      ids
    );
    expect(inv.name).toBe('discount within bounds');
    expect(inv.message).toBe('OK');
    expect(inv.description).toBe('why');
    expect(inv.id).toMatch(/^id-/);
  });

  it('omits description from the patch when not sent', () => {
    const patch = buildInvariantPatch({ name: 'rename only' });
    expect(Object.keys(patch)).toEqual(['name']);
  });

  // This builder cherry-picks known fields, so a fabricated consequent would be
  // dropped here and the invariant would silently become "the antecedent must
  // always be true". Nothing downstream can see it — the evidence is gone by the
  // time the validator runs — so it has to be rejected against the raw input.
  it.each(['mustHold', 'then', 'implies', 'ensure'])(
    'rejects an invariant carrying a fabricated "%s" consequent',
    (key) => {
      const input = {
        name: 'offline copies imply premium',
        condition: { left: 'album.downloaded', operator: 'is_true' },
        message: 'downloaded while not premium',
        [key]: { left: 'user.plan', operator: 'equals', right: 'premium' }
      };
      expect(() => buildInvariant(input, ids)).toThrow(new RegExp(`no "${key}" field`));
      expect(() => buildInvariant(input, ids)).toThrow(/kind: "any"/);
      expect(() => buildInvariantPatch(input)).toThrow(new RegExp(`no "${key}" field`));
    }
  );

  it('still accepts an implication written as any[not(A), B]', () => {
    const inv = buildInvariant(
      {
        name: 'offline copies imply premium',
        message: 'downloaded while not premium',
        condition: {
          kind: 'any',
          conditions: [
            { kind: 'not', condition: { left: 'album.downloaded', operator: 'is_true' } },
            { left: 'user.plan', operator: 'equals', right: 'premium' }
          ]
        }
      },
      ids
    );
    expect(inv.condition).toMatchObject({ kind: 'any' });
  });
});

describe('_entity_builders.buildAcceptanceCriterion', () => {
  it('builds a full criterion from complete input', () => {
    const ac = buildAcceptanceCriterion(
      {
        title: 'Refund within window',
        given: 'delivered 20 days ago',
        when: 'refund requested',
        then: 'refund approved',
        expectedOutcome: 'success',
        relatedSurfaceId: 'srf-1',
        description: 'note'
      },
      ids
    );
    expect(ac.title).toBe('Refund within window');
    expect(ac.expectedOutcome).toBe('success');
    expect(ac.relatedSurfaceId).toBe('srf-1');
    expect(ac.id).toMatch(/^id-/);
  });

  it('defaults given/when/then to empty strings when absent (prose is optional)', () => {
    const ac = buildAcceptanceCriterion({ title: 'Only a title' }, ids);
    expect(ac.given).toBe('');
    expect(ac.when).toBe('');
    expect(ac.then).toBe('');
  });

  it('repairs a missing or out-of-enum expectedOutcome to "success"', () => {
    expect(buildAcceptanceCriterion({ title: 't' }, ids).expectedOutcome).toBe('success');
    expect(
      buildAcceptanceCriterion({ title: 't', expectedOutcome: 'nonsense' }, ids).expectedOutcome
    ).toBe('success');
  });

  it('omits an empty relatedSurfaceId rather than storing ""', () => {
    const ac = buildAcceptanceCriterion({ title: 't', relatedSurfaceId: '' }, ids);
    expect('relatedSurfaceId' in ac).toBe(false);
  });
});

describe('_entity_builders.buildAcceptanceCriterionPatch', () => {
  it('omits keys the caller did not send', () => {
    const patch = buildAcceptanceCriterionPatch({ title: 'renamed' });
    expect(Object.keys(patch)).toEqual(['title']);
  });

  it('repairs an out-of-enum expectedOutcome in a patch', () => {
    expect(buildAcceptanceCriterionPatch({ expectedOutcome: 'weird' }).expectedOutcome).toBe(
      'success'
    );
  });

  it('clears the surface link with relatedSurfaceId: null', () => {
    const patch = buildAcceptanceCriterionPatch({ relatedSurfaceId: null });
    expect('relatedSurfaceId' in patch).toBe(true);
    expect(patch.relatedSurfaceId).toBeUndefined();
  });
});
