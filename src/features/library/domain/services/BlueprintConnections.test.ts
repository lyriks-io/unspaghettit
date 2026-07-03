import { describe, expect, it } from 'vitest';
import { asSurfaceId } from '$features/behavior-model/domain/value-objects/ids';
import type { SurfaceBlueprint } from '../entities/SurfaceBlueprint';
import { asBlueprintId, type BlueprintId } from '../value-objects/BlueprintId';
import { areBlueprintsConnectable, connectableToSelection } from './BlueprintConnections';

const stub = (init: {
  id: string;
  name: string;
  siblings?: readonly string[];
}): SurfaceBlueprint => ({
  id: asBlueprintId(init.id),
  name: init.name,
  category: 'auth',
  surfaceType: 'screen',
  summary: '',
  description: '',
  platforms: ['web'],
  tags: [],
  siblings: init.siblings?.map(asBlueprintId),
  build: () => ({
    surface: {
      id: asSurfaceId('s'),
      name: init.name,
      type: 'screen',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  })
});

const signIn = stub({ id: 'sign-in', name: 'Sign in', siblings: ['sign-up', 'reset'] });
const signUp = stub({ id: 'sign-up', name: 'Sign up' });
const reset = stub({ id: 'reset', name: 'Reset password' });
const cart = stub({ id: 'cart', name: 'Cart', siblings: ['sign-in'] });
const lonely = stub({ id: 'lonely', name: 'Not found' });
const all = [signIn, signUp, reset, cart, lonely];

const sel = (...ids: string[]): ReadonlySet<BlueprintId> => new Set(ids.map(asBlueprintId));

describe('areBlueprintsConnectable', () => {
  it('is true when the first lists the second', () => {
    expect(areBlueprintsConnectable(signIn, signUp)).toBe(true);
  });

  it('is symmetric: true when only the second lists the first', () => {
    expect(areBlueprintsConnectable(signUp, signIn)).toBe(true);
    // Cart lists Sign in, Sign in does not list Cart, yet they connect.
    expect(areBlueprintsConnectable(signIn, cart)).toBe(true);
  });

  it('is false for unrelated blueprints', () => {
    expect(areBlueprintsConnectable(signUp, cart)).toBe(false);
  });

  it('is false for a blueprint against itself', () => {
    expect(areBlueprintsConnectable(signIn, signIn)).toBe(false);
  });
});

describe('connectableToSelection', () => {
  it('is empty with no selection', () => {
    expect(connectableToSelection(all, sel()).size).toBe(0);
  });

  it('highlights unselected blueprints that link to the selection', () => {
    const map = connectableToSelection(all, sel('sign-in'));
    expect([...map.keys()].map(String).sort()).toEqual(['cart', 'reset', 'sign-up']);
    expect(map.get(asBlueprintId('sign-up'))).toEqual(['Sign in']);
  });

  it('never includes an already-selected blueprint', () => {
    const map = connectableToSelection(all, sel('sign-in', 'sign-up'));
    expect(map.has(asBlueprintId('sign-in'))).toBe(false);
    expect(map.has(asBlueprintId('sign-up'))).toBe(false);
  });

  it('lists every selected surface a card connects to, sorted', () => {
    // Cart connects to Sign in; also make Reset a sibling target of Cart.
    const cartTwo = stub({ id: 'cart', name: 'Cart', siblings: ['sign-in', 'reset'] });
    const map = connectableToSelection([signIn, reset, cartTwo], sel('sign-in', 'reset'));
    expect(map.get(asBlueprintId('cart'))).toEqual(['Reset password', 'Sign in']);
  });

  it('omits blueprints with no connection to the selection', () => {
    const map = connectableToSelection(all, sel('sign-in'));
    expect(map.has(asBlueprintId('lonely'))).toBe(false);
  });
});
