import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Effect } from '$features/behavior-model/domain/value-objects/Effect';
import type { Expression } from '$features/behavior-model/domain/value-objects/Expression';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asPersonaId,
  asRuleId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import type { RuleCondition } from '$features/behavior-model/domain/value-objects/RuleCondition';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { StateValue } from '$features/behavior-model/domain/value-objects/StateValue';
import { diffSnapshots, simulateSteps, WalkStepNotFoundError } from './SimulateSteps';

/**
 * A cart: Add item counts one more (refused at the stock), Check out moves to
 * the thanks page and emits an event a handler of the same feature counts,
 * and Apply coupon takes a code of at least four characters.
 */

let seq = 0;
const id = (prefix: string) => `${prefix}-${seq++}`;

const decl = (path: string, type: StateDefinition['type'], defaultValue: StateValue): StateDefinition => ({
  id: asStateDefinitionId(`d-${path}`),
  path: asStatePath(path),
  type,
  defaultValue
});

const state = (path: string): Expression => ({ kind: 'state', path: asStatePath(path) });
const plus = (path: string, n: number): Expression => ({
  kind: 'add',
  left: state(path),
  right: { kind: 'literal', value: n }
});
const set = (path: string, value: Expression | StateValue): Effect => ({
  id: asEffectId(id('e')),
  type: 'set_state',
  path: asStatePath(path),
  value
});
const block = (condition: RuleCondition, reason: string) => ({
  id: asRuleId(id('r')),
  category: 'validation' as const,
  condition,
  effect: { id: asEffectId(id('e')), type: 'block_action' as const, reason }
});

const action = (actionId: string, part: Partial<Action>): Action => ({
  id: asActionId(actionId),
  name: actionId,
  intent: actionId,
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  ...part
});

const addItem = action('add', {
  name: 'Add item',
  rules: [block({ left: asStatePath('cart.items'), operator: 'greater_or_equal', right: state('stock.left') }, 'Out of stock.')],
  effects: [set('cart.items', plus('cart.items', 1))]
});
const checkout = action('checkout', {
  name: 'Check out',
  rules: [block({ left: asStatePath('cart.items'), operator: 'equals', right: 0 }, 'Your cart is empty.')],
  effects: [
    { id: asEffectId('go'), type: 'transition_surface', target: asSurfaceId('thanks') },
    { id: asEffectId('ev'), type: 'emit_event', event: asEventName('order.placed') }
  ],
  emittedEvents: [asEventName('order.placed')]
});
const countOrder = action('count', {
  name: 'Count the order',
  triggeredByEvent: asEventName('order.placed'),
  effects: [
    set('shop.orders', plus('shop.orders', 1)),
    { id: asEffectId('ev2'), type: 'emit_event', event: asEventName('order.counted') }
  ],
  emittedEvents: [asEventName('order.counted')]
});
const thankBuyer = action('thank', {
  name: 'Thank the buyer',
  triggeredByEvent: asEventName('order.counted'),
  effects: [set('shop.thanked', true)]
});
const applyCoupon = action('coupon', {
  name: 'Apply coupon',
  parameters: [
    {
      id: asParameterId('code'),
      name: 'code',
      type: 'string',
      required: true,
      validations: [{ type: 'min_length', value: 4, message: 'is too short' }]
    }
  ],
  effects: [set('cart.coupon', { kind: 'param', name: 'code' })]
});
const expire = action('expire', {
  name: 'Expire the cart',
  rules: [
    block(
      { left: asStatePath('clock.now'), operator: 'lower_than', right: state('cart.expiresAt') },
      'The cart has not expired yet.'
    )
  ],
  effects: [set('cart.items', 0)]
});

const cartSurface: Surface = {
  id: asSurfaceId('cart'),
  name: 'Cart',
  type: 'screen',
  stateDefinitions: [
    decl('cart.items', 'number', 0),
    decl('stock.left', 'number', 2),
    decl('cart.coupon', 'string', ''),
    decl('cart.expiresAt', 'number', 100),
    decl('shop.orders', 'number', 0),
    decl('shop.thanked', 'boolean', false)
  ],
  actions: [addItem, checkout, countOrder, thankBuyer, applyCoupon, expire],
  rules: [],
  invariants: [],
  transitions: []
};
const thanksSurface: Surface = {
  id: asSurfaceId('thanks'),
  name: 'Thanks',
  type: 'screen',
  stateDefinitions: [],
  actions: [],
  rules: [],
  invariants: [],
  transitions: []
};

const cart = (part: Partial<Feature> = {}): Feature => ({
  id: asFeatureId('cart-feature'),
  name: 'Cart',
  surfaces: [cartSurface, thanksSurface],
  personas: [
    {
      id: asPersonaId('loyal'),
      name: 'Loyal customer',
      stateOverrides: [{ path: asStatePath('stock.left'), value: 9 }],
      parameterOverrides: [{ parameterName: 'code', value: 'LOYAL10' }]
    }
  ],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...part
});

const items = (snapshot: unknown): unknown => (snapshot as { cart: { items: unknown } }).cart.items;

describe('simulateSteps', () => {
  it('threads the state from one step to the next and says what each step changed', () => {
    const walk = simulateSteps({ feature: cart(), steps: [{ actionId: 'add' }, { actionId: 'add' }] });
    expect(walk.steps.map((s) => [s.actionName, s.status])).toEqual([
      ['Add item', 'success'],
      ['Add item', 'success']
    ]);
    // The first step reports its own change, not every declared default.
    expect(walk.steps[0]!.changes).toEqual([{ path: 'cart.items', before: 0, after: 1 }]);
    expect(walk.steps[1]!.changes).toEqual([{ path: 'cart.items', before: 1, after: 2 }]);
    expect(items(walk.finalState)).toBe(2);
    expect(walk.notRun).toBe(0);
  });

  it('refuses a step with the rule\'s reason, changes nothing, and goes on from the same state', () => {
    const walk = simulateSteps({
      feature: cart(),
      steps: [{ actionId: 'checkout' }, { actionId: 'add' }, { actionId: 'checkout' }]
    });
    const [refused, added, placed] = walk.steps;
    expect(refused).toMatchObject({ status: 'blocked', refusedBecause: ['Your cart is empty.'], changes: [], movedTo: null });
    expect(refused!.emittedEvents).toEqual([]);
    expect(added!.changes).toEqual([{ path: 'cart.items', before: 0, after: 1 }]);
    expect(placed).toMatchObject({ status: 'success', movedTo: { surfaceId: 'thanks', surfaceName: 'Thanks' } });
    expect(placed!.emittedEvents).toEqual(['order.placed']);
  });

  it('ends the walk at the first refusal when asked, and counts the steps it did not run', () => {
    const walk = simulateSteps({
      feature: cart(),
      steps: [{ actionId: 'add' }, { actionId: 'checkout', surfaceId: 'cart' }, { actionId: 'add' }, { actionId: 'add' }],
      snapshot: { stock: { left: 1 } },
      stopOnBlocked: true
    });
    // One in stock: the second add is the refusal, the checkout before it passed.
    expect(walk.steps.map((s) => s.status)).toEqual(['success', 'success', 'blocked']);
    expect(walk.steps[2]!.refusedBecause).toEqual(['Out of stock.']);
    expect(walk.notRun).toBe(1);
    expect(items(walk.finalState)).toBe(1);
  });

  it('reports the handlers an emitted event wakes up, down the chain, and keeps what they wrote', () => {
    const walk = simulateSteps({ feature: cart(), steps: [{ actionId: 'add' }, { actionId: 'checkout' }] });
    expect(walk.steps[1]!.cascaded).toEqual([
      { triggeredBy: 'order.placed', depth: 1, actionId: 'count', actionName: 'Count the order', status: 'success' },
      { triggeredBy: 'order.counted', depth: 2, actionId: 'thank', actionName: 'Thank the buyer', status: 'success' }
    ]);
    expect((walk.finalState as { shop: { orders: number; thanked: boolean } }).shop).toMatchObject({
      orders: 1,
      thanked: true
    });
    expect(walk.steps[0]!.cascaded).toBeUndefined();
  });

  it('refuses a step that would break an invariant, shows what it tried apart, and keeps the state before it', () => {
    const atMostOne: Invariant = {
      id: asInvariantId('one'),
      name: 'One item at most',
      condition: { left: asStatePath('cart.items'), operator: 'lower_or_equal', right: 1 },
      message: 'A cart holds one item.'
    };
    const walk = simulateSteps({
      feature: cart({ featureInvariants: [atMostOne] }),
      steps: [{ actionId: 'add' }, { actionId: 'add' }, { actionId: 'coupon', parameters: { code: 'SAVE5' } }]
    });
    const [, broken, after] = walk.steps;
    expect(broken!.status).toBe('blocked');
    expect(broken!.refusedBecause).toEqual(['One item at most: A cart holds one item.']);
    expect(broken!.changes).toEqual([]);
    expect(broken!.rejectedChanges).toEqual([{ path: 'cart.items', before: 1, after: 2 }]);
    // The walk goes on from one item, not from the refused two.
    expect(after!.status).toBe('success');
    expect(items(walk.finalState)).toBe(1);
  });

  it('checks a project invariant over another feature\'s state, filled from that feature\'s defaults', () => {
    const capacity: Invariant = {
      id: asInvariantId('cap'),
      name: 'Carts fit the warehouse',
      condition: { left: asStatePath('cart.items'), operator: 'lower_or_equal', right: state('warehouse.capacity') },
      message: 'More than the warehouse holds.'
    };
    const walk = simulateSteps({
      feature: cart(),
      steps: [{ actionId: 'add' }, { actionId: 'add' }],
      extraInvariants: [capacity],
      seedStateDefs: [decl('warehouse.capacity', 'number', 1), decl('cart.items', 'number', 50)]
    });
    expect(walk.steps.map((s) => s.status)).toEqual(['success', 'blocked']);
    expect(walk.steps[1]!.refusedBecause).toEqual(['Carts fit the warehouse: More than the warehouse holds.']);
    // The feature's own default wins over another feature's for a path it declares.
    expect(walk.steps[0]!.changes).toEqual([{ path: 'cart.items', before: 0, after: 1 }]);
  });

  it('refuses an input that fails its validation, naming the parameter', () => {
    const walk = simulateSteps({ feature: cart(), steps: [{ actionId: 'coupon', parameters: { code: 'AB' } }] });
    expect(walk.steps[0]).toMatchObject({ status: 'blocked', refusedBecause: ['code: is too short'], changes: [] });
  });

  it('starts from a persona\'s state and takes its parameter values unless a step gives its own', () => {
    const walk = simulateSteps({
      feature: cart(),
      personaId: 'loyal',
      steps: [
        { actionId: 'coupon' },
        { actionId: 'coupon', parameters: { code: 'MINE1' } },
        { actionId: 'add' },
        { actionId: 'add' },
        { actionId: 'add' }
      ]
    });
    expect(walk.steps[0]!.parameters).toEqual({ code: 'LOYAL10' });
    expect(walk.steps[0]!.changes).toEqual([{ path: 'cart.coupon', before: '', after: 'LOYAL10' }]);
    expect(walk.steps[1]!.changes).toEqual([{ path: 'cart.coupon', before: 'LOYAL10', after: 'MINE1' }]);
    // Nine in stock for this persona: three adds pass where the default two would refuse the third.
    expect(walk.steps.slice(2).map((s) => s.status)).toEqual(['success', 'success', 'success']);
  });

  it('lets logical time pass before a step', () => {
    const walk = simulateSteps({
      feature: cart(),
      snapshot: { cart: { items: 3 }, clock: { now: 0 } },
      steps: [{ actionId: 'expire' }, { actionId: 'expire', timeAdvance: 150 }]
    });
    expect(walk.steps[0]!.refusedBecause).toEqual(['The cart has not expired yet.']);
    expect(walk.steps[1]!.status).toBe('success');
    expect(walk.steps[1]!.changes).toEqual([{ path: 'cart.items', before: 3, after: 0 }]);
    expect((walk.finalState as { clock: { now: number } }).clock.now).toBe(150);
  });

  it('refuses the whole walk, before running any step, when a step names nothing the feature holds', () => {
    expect(() => simulateSteps({ feature: cart(), steps: [{ actionId: 'add' }, { actionId: 'nope' }] })).toThrow(
      WalkStepNotFoundError
    );
    expect(() => simulateSteps({ feature: cart(), steps: [{ actionId: 'nope' }] })).toThrow(/Add item/);
    expect(() =>
      simulateSteps({ feature: cart(), steps: [{ actionId: 'add', surfaceId: 'thanks' }] })
    ).toThrow(/Step 0: action add is not in feature cart-feature on surface thanks/);
    expect(() => simulateSteps({ feature: cart(), steps: [{ actionId: 'add', surfaceId: 'gone' }] })).toThrow(
      /surface gone is not in feature/
    );
    expect(() => simulateSteps({ feature: cart(), personaId: 'ghost', steps: [] })).toThrow(/Loyal customer/);
  });
});

describe('diffSnapshots', () => {
  it('lists every leaf that moved, appeared or disappeared, in path order, a list as one value', () => {
    expect(
      diffSnapshots(
        { cart: { items: 1, lines: ['a'], coupon: 'X' }, user: { name: 'Ada' } },
        { cart: { items: 2, lines: ['a', 'b'] }, user: { name: 'Ada' }, shop: { open: true } }
      )
    ).toEqual([
      { path: 'cart.coupon', before: 'X', after: undefined },
      { path: 'cart.items', before: 1, after: 2 },
      { path: 'cart.lines', before: ['a'], after: ['a', 'b'] },
      { path: 'shop.open', before: undefined, after: true }
    ]);
  });

  it('finds nothing between equal snapshots', () => {
    expect(diffSnapshots({ a: { b: [1, { c: 2 }] } }, { a: { b: [1, { c: 2 }] } })).toEqual([]);
  });
});
