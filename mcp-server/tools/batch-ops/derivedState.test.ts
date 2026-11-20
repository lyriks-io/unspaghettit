import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '../../../src/features/behavior-model/domain/value-objects/ids';
import { applyOps } from './applyOps';
import type { Op } from './opHelpers';

/**
 * A computed state (`derived`) declared or changed through apply_batch, as the
 * granular add_state_definition and update_state_definition take it. The batch
 * used to drop the expression without a word, leaving an ordinary state that
 * nothing ever recomputed.
 */

const blank = (): Feature => ({
  id: asFeatureId('f'),
  name: 'Cart',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

let n = 0;
const run = (ops: readonly Op[], start: Feature = blank()) => applyOps(start, ops, () => `id-${n++}`);

const double = {
  kind: 'mul',
  left: { kind: 'state', path: 'cart.items' },
  right: { kind: 'literal', value: 2 }
};

const cart = () =>
  run([
    { kind: 'add_surface', ref: 'cart', name: 'Cart', type: 'screen', description: 'The cart.' },
    { kind: 'add_state_definition', surfaceRef: 'cart', path: 'cart.items', type: 'number', defaultValue: 0, description: 'Items.' },
    { kind: 'add_state_definition', ref: 'twice', surfaceRef: 'cart', path: 'cart.twice', type: 'number', defaultValue: 0, description: 'Twice the items.', derived: double }
  ]);

const definition = (feature: Feature, path: string) =>
  feature.surfaces.flatMap((s) => s.stateDefinitions).find((d) => String(d.path) === path)!;

describe('a computed state through apply_batch', () => {
  it('keeps the derived expression add_state_definition declares', () => {
    expect(definition(cart().next, 'cart.twice').derived).toEqual(double);
  });

  it('sets, changes and clears it with update_state_definition', () => {
    const built = cart();
    const surfaceId = built.refs.cart!;
    const items = definition(built.next, 'cart.items');
    const triple = { ...double, right: { kind: 'literal', value: 3 } };
    const set = run(
      [{ kind: 'update_state_definition', surfaceId, stateDefinitionId: String(items.id), derived: { kind: 'literal', value: 1 } }],
      built.next
    );
    expect(definition(set.next, 'cart.items').derived).toEqual({ kind: 'literal', value: 1 });
    const changed = run(
      [{ kind: 'update_state_definition', surfaceId, stateDefinitionId: built.refs.twice!, patch: { derived: triple } }],
      built.next
    );
    expect(definition(changed.next, 'cart.twice').derived).toEqual(triple);
    const cleared = run(
      [{ kind: 'update_state_definition', surfaceId, stateDefinitionId: built.refs.twice!, derived: null }],
      built.next
    );
    expect(definition(cleared.next, 'cart.twice').derived).toBeUndefined();
  });
});
