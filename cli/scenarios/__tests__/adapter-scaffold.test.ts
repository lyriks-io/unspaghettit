import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import type { Action } from '../../../src/features/behavior-model/domain/entities/Action';
import {
  asActionId,
  asFeatureId,
  asScenarioId,
  asSurfaceId
} from '../../../src/features/behavior-model/domain/value-objects/ids';
import { generateAdapterStub } from '../adapter-scaffold';

const action = (id: string, name: string, withScenario: boolean): Action => ({
  id: asActionId(id),
  name,
  intent: 'x',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  scenarios: withScenario
    ? [{ id: asScenarioId(`${id}-s`), name: 'happy', stateOverrides: [], parameterOverrides: [] }]
    : []
});

const feature: Feature = {
  id: asFeatureId('f'),
  name: 'Cart',
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [],
      actions: [action('a1', 'Add item', true), action('a2', 'No scenarios', false)],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
};

describe('generateAdapterStub', () => {
  it('emits a case only for scenario-bearing actions', () => {
    const { code, actionCount } = generateAdapterStub(feature);
    expect(actionCount).toBe(1);
    expect(code).toContain('case "a1"');
    expect(code).not.toContain('case "a2"');
    expect(code).toContain('export const adapter: UnspaAdapter');
    expect(code).toContain("from 'unspaghettit/cli/scenarios'");
  });

  it('seeds the implementation location from the behavioral index when present', () => {
    const { code } = generateAdapterStub(feature, {
      index: { 'action:a1': { file: 'src/cart.ts', line: 42, signature: 'addItem()' } }
    });
    expect(code).toContain('// impl: src/cart.ts:42 — addItem()');
  });

  it('honors a custom export name', () => {
    const { code } = generateAdapterStub(feature, { adapterExportName: 'myAdapter' });
    expect(code).toContain('export const myAdapter: UnspaAdapter');
  });
});
