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

/** The same feature, with per-element stamps as a write would leave them. */
const stamped = (updatedAt: string, versions: Record<string, string>): Feature => ({
  ...feature(updatedAt),
  elementVersions: versions
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

describe('detectDrift with element stamps', () => {
  const audited = '2026-06-05T00:00:00.000Z';
  const index: IndexedImplementation[] = [
    { key: 'action:a1', status: 'implemented', auditedSpecVersion: audited },
    { key: 'state:cart.total', status: 'implemented', auditedSpecVersion: audited },
    { key: 'surface:s1', status: 'implemented', auditedSpecVersion: audited }
  ];

  it('implicates only the element that actually moved', () => {
    // The feature was edited on the 10th, but only the action changed then.
    const f = stamped('2026-06-10T00:00:00.000Z', {
      'action:a1': '2026-06-10T00:00:00.000Z',
      'state:cart.total': '2026-06-01T00:00:00.000Z',
      'surface:s1': '2026-06-01T00:00:00.000Z'
    });

    const report = detectDrift([f], index);

    expect(report.stale.map((s) => s.key)).toEqual(['action:a1']);
    expect(report.stale[0]!.scope).toBe('element');
    expect(report.stale[0]!.currentSpecVersion).toBe('2026-06-10T00:00:00.000Z');
    expect(report.checked).toBe(3);
  });

  it('falls back to the feature stamp for an element nobody stamped, and says so', () => {
    const f = stamped('2026-06-10T00:00:00.000Z', {
      'action:a1': '2026-06-01T00:00:00.000Z'
    });

    const report = detectDrift([f], index);

    expect(report.stale.map((s) => s.key).sort()).toEqual(['state:cart.total', 'surface:s1']);
    expect(report.stale.every((s) => s.scope === 'feature')).toBe(true);
  });

  it('resolves an index type the stamps spell differently', () => {
    const f = {
      ...stamped('2026-06-10T00:00:00.000Z', { 'rule:r1': '2026-06-10T00:00:00.000Z' }),
      surfaces: [
        {
          ...feature('x').surfaces[0]!,
          rules: [
            {
              id: 'r1',
              name: 'Cart must not be empty',
              condition: { left: { kind: 'state', path: 'cart.total' }, operator: 'greater_than', right: { kind: 'literal', value: 0 } },
              effect: { type: 'allow_action' }
            }
          ]
        }
      ]
    } as unknown as Feature;

    const report = detectDrift([f], [
      { key: 'surface_rule:r1', status: 'implemented', auditedSpecVersion: audited }
    ]);

    expect(report.stale.map((s) => s.key)).toEqual(['surface_rule:r1']);
    expect(report.stale[0]!.scope).toBe('element');
  });
});
