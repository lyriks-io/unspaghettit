import { describe, expect, it } from 'vitest';
import type { StateDefinition } from '../entities/StateDefinition';
import { writePath, type StateSnapshot } from '../value-objects/StatePath';
import { mergeSnapshotWithDefaults, seedOtherFeatureDefaults } from './StateSnapshot';

const decl = (path: string, defaultValue: unknown): StateDefinition =>
  ({ id: `sd-${path}`, path, type: 'string', defaultValue }) as unknown as StateDefinition;

/** What filling the defaults one write at a time gives. */
const oneByOne = (snapshot: StateSnapshot, defs: readonly StateDefinition[]): StateSnapshot => {
  let result = snapshot;
  for (const def of defs) {
    let cursor: unknown = result;
    for (const segment of String(def.path).split('.')) {
      cursor = cursor && typeof cursor === 'object' && !Array.isArray(cursor) ? (cursor as Record<string, unknown>)[segment] : undefined;
    }
    if (cursor === undefined) result = writePath(result, def.path, def.defaultValue as never);
  }
  return result;
};

describe('filling the missing defaults in one pass', () => {
  const defs = [
    decl('cart.total', 0),
    decl('cart.items', []),
    decl('session', { role: 'guest' }),
    decl('session.user.name', 'nobody'),
    decl('flag', null),
    decl('kept', 'default'),
    decl('primitive.below', 1)
  ];
  const given = { kept: 'mine', flag: null, primitive: 5, cart: { total: 3 } } as unknown as StateSnapshot;

  it('gives what writing them one by one gives, and never changes the snapshot it was given', () => {
    const before = JSON.stringify(given);
    expect(mergeSnapshotWithDefaults(given, defs)).toEqual(oneByOne(given, defs));
    expect(JSON.stringify(given)).toBe(before);
  });

  it('gives the snapshot back as is when nothing is missing', () => {
    const full = mergeSnapshotWithDefaults(given, defs);
    expect(mergeSnapshotWithDefaults(full, defs)).toBe(full);
  });

  it('seeds the other features without touching the paths the feature declares itself', () => {
    const seeded = seedOtherFeatureDefaults({} as StateSnapshot, [decl('kept', 'own')], defs);
    expect(seeded).toEqual(oneByOne({} as StateSnapshot, defs.filter((d) => d.path !== 'kept')));
  });
});
