import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import {
  elementDigests,
  elementVersionOf,
  nextElementVersions,
  stampElementVersions
} from './FeatureElementVersions';

const RULE = {
  id: 'r1',
  name: 'Cart must not be empty',
  category: 'validation',
  condition: {
    left: { kind: 'state', path: 'cart.total' },
    operator: 'greater_than',
    right: { kind: 'literal', value: 0 }
  },
  effect: { type: 'block_action', reason: 'empty_cart' }
};

const build = (overrides: Record<string, unknown> = {}): Feature =>
  ({
    id: 'feat',
    name: 'Cart',
    surfaces: [
      {
        id: 's1',
        name: 'Cart',
        type: 'screen',
        stateDefinitions: [{ id: 'd1', path: 'cart.total', type: 'number', defaultValue: 0 }],
        actions: [
          {
            id: 'a1',
            name: 'Add item',
            intent: 'add an item to the cart',
            parameters: [],
            requiredStates: [],
            rules: [RULE],
            invariants: [],
            effects: [],
            emittedEvents: [],
            transitions: [],
            scenarios: [{ id: 'sc1', name: 'adds one', expectedStatus: 'success' }]
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
    events: [{ id: 'e1', name: 'cart.updated' }],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides
  }) as unknown as Feature;

/** Same feature with one rule field changed. */
const withEditedRule = (base: Feature): Feature =>
  JSON.parse(
    JSON.stringify(base).replace('Cart must not be empty', 'Cart needs at least one item')
  ) as Feature;

describe('elementDigests', () => {
  it('keys every element the behavioral index can address', () => {
    const keys = [...elementDigests(build()).keys()].sort();
    expect(keys).toEqual([
      'action:a1',
      'event:cart.updated',
      'rule:r1',
      'scenario:sc1',
      'state:cart.total',
      'surface:s1'
    ]);
  });

  it('excludes children that carry their own key, so an edit stays local', () => {
    const before = elementDigests(build());
    const after = elementDigests(withEditedRule(build()));

    expect(after.get('rule:r1')).not.toBe(before.get('rule:r1'));
    expect(after.get('action:a1')).toBe(before.get('action:a1'));
    expect(after.get('surface:s1')).toBe(before.get('surface:s1'));
  });

  it('ignores key order, so a re-serialized snapshot is not a change', () => {
    const reordered = JSON.parse(
      JSON.stringify(build(), ['surfaces', 'actions', 'rules', 'id', 'name', 'type', 'stateDefinitions', 'path'])
    ) as Feature;
    // Same rule content reached through a different property order.
    expect(elementDigests(reordered).get('rule:r1')).toBe(
      elementDigests(
        JSON.parse(JSON.stringify(reordered, ['surfaces', 'rules', 'actions', 'id', 'name', 'type', 'stateDefinitions', 'path'])) as Feature
      ).get('rule:r1')
    );
  });
});

describe('nextElementVersions', () => {
  const NOW = '2026-06-20T00:00:00.000Z';

  it('stamps only what changed and keeps the rest where it was', () => {
    const before = stampElementVersions(null, build(), '2026-06-01T00:00:00.000Z');
    const after = nextElementVersions(before, withEditedRule(before), NOW);

    expect(after['rule:r1']).toBe(NOW);
    expect(after['action:a1']).toBe('2026-06-01T00:00:00.000Z');
    expect(after['surface:s1']).toBe('2026-06-01T00:00:00.000Z');
  });

  it('moves the action stamp, and only it, when the actor changes', () => {
    const before = stampElementVersions(null, build(), '2026-06-01T00:00:00.000Z');
    const reassigned = JSON.parse(JSON.stringify(before)) as Feature;
    (reassigned.surfaces[0]!.actions[0] as unknown as Record<string, unknown>).actor = 'system';
    const after = nextElementVersions(before, reassigned, NOW);

    expect(after['action:a1']).toBe(NOW);
    expect(after['rule:r1']).toBe('2026-06-01T00:00:00.000Z');
    expect(after['scenario:sc1']).toBe('2026-06-01T00:00:00.000Z');
    expect(after['surface:s1']).toBe('2026-06-01T00:00:00.000Z');
  });

  it('stamps a brand-new element with the write time', () => {
    const before = stampElementVersions(null, build(), '2026-06-01T00:00:00.000Z');
    const grown = JSON.parse(JSON.stringify(before)) as Feature;
    (grown.surfaces[0]!.actions[0]!.rules as unknown[]).push({ ...RULE, id: 'r2' });

    expect(nextElementVersions(before, grown, NOW)['rule:r2']).toBe(NOW);
  });

  it('drops an element that no longer exists', () => {
    const before = stampElementVersions(null, build(), '2026-06-01T00:00:00.000Z');
    const shrunk = JSON.parse(JSON.stringify(before)) as Feature;
    (shrunk.surfaces[0]!.actions[0]! as unknown as { rules: unknown[] }).rules = [];

    expect(nextElementVersions(before, shrunk, NOW)['rule:r1']).toBeUndefined();
  });

  it('calibrates an unstamped legacy feature at its own updatedAt, never later', () => {
    const legacy = build({ updatedAt: '2026-06-10T00:00:00.000Z' });
    const versions = nextElementVersions(legacy, withEditedRule(legacy), NOW);

    // The one element that changed carries the write time; everything else
    // inherits the only truth the legacy snapshot had.
    expect(versions['rule:r1']).toBe(NOW);
    expect(versions['action:a1']).toBe('2026-06-10T00:00:00.000Z');
    expect(versions['state:cart.total']).toBe('2026-06-10T00:00:00.000Z');
  });

  it('stamps everything on a first write with no previous snapshot', () => {
    const versions = nextElementVersions(null, build(), NOW);
    expect(Object.values(versions).every((v) => v === NOW)).toBe(true);
  });
});

describe('elementVersionOf', () => {
  const stamped = build({
    elementVersions: { 'rule:r1': '2026-06-20T00:00:00.000Z', 'action:a1': '2026-06-01T00:00:00.000Z' }
  });

  it('reads the exact key', () => {
    expect(elementVersionOf(stamped, 'rule:r1')).toBe('2026-06-20T00:00:00.000Z');
  });

  it('accepts the aliases the index uses for the same concept', () => {
    expect(elementVersionOf(stamped, 'surface_rule:r1')).toBe('2026-06-20T00:00:00.000Z');
    expect(elementVersionOf(stamped, 'capability:a1')).toBe('2026-06-01T00:00:00.000Z');
  });

  it('falls back to any element with that identifier before giving up', () => {
    expect(elementVersionOf(stamped, 'unknown_type:r1')).toBe('2026-06-20T00:00:00.000Z');
    expect(elementVersionOf(stamped, 'rule:nope')).toBeUndefined();
  });

  it('returns nothing for a feature that was never stamped', () => {
    expect(elementVersionOf(build(), 'rule:r1')).toBeUndefined();
  });
});

describe('acceptance criteria are stamped like any other element', () => {
  const NOW = '2026-06-20T00:00:00.000Z';
  const CRITERIA = [
    { id: 'c1', title: 'Footsteps are silent in water', given: '', when: '', then: '', expectedOutcome: 'success' },
    { id: 'c2', title: 'Shallow water is audible', given: '', when: '', then: '', expectedOutcome: 'success' }
  ];

  it('keys each criterion as criterion:<id>', () => {
    const keys = [...elementDigests(build({ acceptanceCriteria: CRITERIA })).keys()];
    expect(keys).toContain('criterion:c1');
    expect(keys).toContain('criterion:c2');
  });

  it('moves the stamp of the edited criterion only', () => {
    const before = stampElementVersions(
      null,
      build({ acceptanceCriteria: CRITERIA }),
      '2026-06-01T00:00:00.000Z'
    );
    const edited = JSON.parse(JSON.stringify(before)) as Feature;
    (edited.acceptanceCriteria as unknown as Record<string, unknown>[])[0]!.status = 'superseded';
    const after = nextElementVersions(before, edited, NOW);

    expect(after['criterion:c1']).toBe(NOW);
    expect(after['criterion:c2']).toBe('2026-06-01T00:00:00.000Z');
    expect(after['action:a1']).toBe('2026-06-01T00:00:00.000Z');
  });

  it('moves the stamp when a relation is added, since it changes what the criterion means', () => {
    const before = stampElementVersions(
      null,
      build({ acceptanceCriteria: CRITERIA }),
      '2026-06-01T00:00:00.000Z'
    );
    const related = JSON.parse(JSON.stringify(before)) as Feature;
    (related.acceptanceCriteria as unknown as Record<string, unknown>[])[1]!.relations = [
      { kind: 'supersedes', criterionId: 'c1' }
    ];
    const after = nextElementVersions(before, related, NOW);

    expect(after['criterion:c2']).toBe(NOW);
    expect(after['criterion:c1']).toBe('2026-06-01T00:00:00.000Z');
  });

  it('calibrates criteria of a feature stamped before they were keyed, never later than its updatedAt', () => {
    // A 0.23 snapshot: it carries stamps, but none for its criteria.
    const legacy = {
      ...stampElementVersions(null, build(), '2026-06-01T00:00:00.000Z'),
      acceptanceCriteria: CRITERIA,
      updatedAt: '2026-06-03T00:00:00.000Z'
    } as unknown as Feature;
    const touched = JSON.parse(JSON.stringify(legacy)) as Feature;
    (touched.acceptanceCriteria as unknown as Record<string, unknown>[])[0]!.title = 'Reworded';
    const after = nextElementVersions(legacy, touched, NOW);

    expect(after['criterion:c1']).toBe(NOW);
    expect(after['criterion:c2']).toBe('2026-06-03T00:00:00.000Z');
  });
});
