import { describe, expect, it } from 'vitest';
import {
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
});
