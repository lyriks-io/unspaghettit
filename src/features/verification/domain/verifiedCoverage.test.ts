import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { asActionId, asFeatureId, asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { IndexedImplementation } from './IndexedImplementation';
import { verifiedCoverageForFeature } from './verifiedCoverage';

const action = (id: string, over: Partial<Action> = {}): Action => ({
  id: asActionId(id),
  name: id,
  intent: 'x',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  ...over
});

const feature = (actions: readonly Action[]): Feature => ({
  id: asFeatureId('f'),
  name: 'F',
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'S',
      type: 'screen',
      stateDefinitions: [],
      actions,
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
});

describe('verifiedCoverageForFeature', () => {
  it('counts actions whose index entry carries verifiedAt', () => {
    const f = feature([action('a1'), action('a2'), action('a3')]);
    const index: IndexedImplementation[] = [
      { key: 'action:a1', status: 'implemented', verifiedAt: '2026-06-10T00:00:00.000Z' },
      { key: 'action:a2', status: 'implemented' }, // implemented, not verified
      { key: 'state:x', status: 'implemented', verifiedAt: '2026-06-10T00:00:00.000Z' } // non-action ignored
    ];
    expect(verifiedCoverageForFeature(f, index)).toEqual({ verified: 1, total: 3 });
  });

  it('excludes evolution placeholders from the denominator', () => {
    const f = feature([
      action('a1', { evolution: { rationale: 'someday' } as never }),
      action('a2')
    ]);
    expect(verifiedCoverageForFeature(f, [])).toEqual({ verified: 0, total: 1 });
  });
});
