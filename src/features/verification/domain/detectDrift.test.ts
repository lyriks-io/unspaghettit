import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  asActionId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { detectDrift } from './detectDrift';
import type { IndexedImplementation } from './IndexedImplementation';

const feature = (updatedAt: string): Feature => ({
  id: asFeatureId('feat'),
  name: 'Cart',
  surfaces: [
    {
      id: asSurfaceId('s1'),
      name: 'Cart',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId('d1'),
          path: asStatePath('cart.total'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [
        {
          id: asActionId('a1'),
          name: 'Add item',
          intent: 'add an item to the cart',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt
});

describe('detectDrift', () => {
  it('flags entries audited before the feature last changed, and only those', () => {
    const f = feature('2026-06-10T00:00:00.000Z');
    const index: IndexedImplementation[] = [
      // audited BEFORE the feature changed → stale
      { key: 'action:a1', status: 'implemented', auditedSpecVersion: '2026-06-01T00:00:00.000Z' },
      // audited AFTER → fresh, not stale
      { key: 'state:cart.total', status: 'implemented', auditedSpecVersion: '2026-06-20T00:00:00.000Z' },
      // resolvable but never stamped → unversioned
      { key: 'surface:s1', status: 'implemented' },
      // no such entity → orphan
      { key: 'action:ghost', status: 'partial', auditedSpecVersion: '2026-06-01T00:00:00.000Z' },
      // not implemented yet → ignored entirely
      { key: 'state:cart.total', status: 'missing', auditedSpecVersion: '2026-06-01T00:00:00.000Z' },
      // no "type:suffix" shape → orphan
      { key: 'malformed', status: 'implemented' }
    ];

    const report = detectDrift([f], index);

    expect(report.stale.map((s) => s.key)).toEqual(['action:a1']);
    expect(report.stale[0]!.currentSpecVersion).toBe('2026-06-10T00:00:00.000Z');
    expect(report.stale[0]!.featureName).toBe('Cart');
    expect(report.unversioned).toEqual(['surface:s1']);
    expect(report.orphans.map((o) => o.key).sort()).toEqual(['action:ghost', 'malformed']);
    // action:a1, state:cart.total (fresh), surface:s1 (unversioned) all resolved & audited
    expect(report.checked).toBe(3);
  });

  it('reports nothing when every audit is at or after the current spec version', () => {
    const f = feature('2026-06-10T00:00:00.000Z');
    const report = detectDrift([f], [
      { key: 'action:a1', status: 'implemented', auditedSpecVersion: '2026-06-10T00:00:00.000Z' }
    ]);
    expect(report.stale).toEqual([]);
    expect(report.unversioned).toEqual([]);
    expect(report.orphans).toEqual([]);
  });
});
