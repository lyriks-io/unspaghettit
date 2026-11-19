import { describe, expect, it } from 'vitest';
import type { Feature } from '../../../src/features/behavior-model/domain/entities/Feature';
import { asFeatureId } from '../../../src/features/behavior-model/domain/value-objects/ids';
import { applyOps } from './applyOps';
import type { Op } from './opHelpers';

/**
 * The batch op handlers on their own, below the MCP server: each op is
 * applied to a feature in memory and the feature it leaves is read back.
 * These are the ops the server tests never reached (a mutation of their
 * handlers went unnoticed): updating events and dependencies, linking project
 * definitions, parameters bound to state or value sets, moving down, a
 * transition effect aimed at a surface of the same batch, entities with
 * fields, the nested forms of a resource update.
 */

const blank = (): Feature => ({
  id: asFeatureId('f'),
  name: 'Shop',
  surfaces: [],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z'
});

const run = (ops: readonly Op[], start: Feature = blank()) => {
  let n = 0;
  return applyOps(start, ops, () => `id-${n++}`);
};

/** A shop with one surface holding two actions, a value set, an event and a dependency. */
const shop = () =>
  run([
    { kind: 'add_surface', ref: 'cart', name: 'Cart', type: 'screen', description: 'The cart.' },
    { kind: 'add_surface', ref: 'done', name: 'Thanks', type: 'screen', description: 'Done.' },
    { kind: 'add_state_definition', surfaceRef: 'cart', path: 'cart.items', type: 'number', defaultValue: 0, description: 'Items.' },
    { kind: 'add_value_set', ref: 'sizes', name: 'Sizes', description: 'Sizes.', values: ['S', 'M'] },
    { kind: 'add_action', ref: 'add', surfaceRef: 'cart', name: 'Add item', intent: 'Add.' },
    { kind: 'add_action', ref: 'pay', surfaceRef: 'cart', name: 'Pay', intent: 'Pay.' },
    { kind: 'add_event', ref: 'paid', name: 'order.paid', description: 'Paid.' },
    {
      kind: 'add_dependency',
      ref: 'psp',
      name: 'Payments',
      dependencyKind: 'service',
      description: 'The payment provider.',
      operations: [{ name: 'charge', description: 'Charge.' }]
    }
  ]);

const actionNames = (f: Feature) => f.surfaces[0]!.actions.map((a) => a.name);

describe('applyOps', () => {
  it('updates an event: its name, its description, its payload, and clears the payload with an empty list', () => {
    const { next, refs } = shop();
    const updated = run(
      [
        {
          kind: 'update_event',
          eventId: refs.paid,
          name: 'order.settled',
          description: 'Settled.',
          payloadSchema: [{ name: 'amount', type: 'number', required: true, description: 'Paid amount.' }]
        }
      ],
      next
    ).next;
    expect(updated.events).toEqual([
      {
        id: refs.paid,
        name: 'order.settled',
        description: 'Settled.',
        payloadSchema: [{ name: 'amount', type: 'number', required: true, description: 'Paid amount.' }]
      }
    ]);
    const cleared = run([{ kind: 'update_event', eventId: refs.paid, patch: { payloadSchema: [] } }], updated).next;
    expect(cleared.events?.[0]?.payloadSchema).toBeUndefined();
    expect(cleared.events?.[0]?.name).toBe('order.settled');
  });

  it('refuses to update an event, a dependency or a resource that does not exist, naming the op', () => {
    const { next } = shop();
    expect(() => run([{ kind: 'update_event', eventId: 'ghost', name: 'x.y' }], next)).toThrow(/op\[0\] \(update_event\).*event "ghost" not found/);
    expect(() => run([{ kind: 'update_dependency', dependencyId: 'ghost', name: 'X' }], next)).toThrow(/dependency "ghost" not found/);
    expect(() => run([{ kind: 'update_resource', resourceId: 'ghost', name: 'X' }], next)).toThrow(/resource "ghost" not found/);
  });

  it('updates a dependency and replaces its operations whole, each with a fresh id', () => {
    const { next, refs } = shop();
    const before = next.dependencies![0]!.operations[0]!.id;
    const updated = run(
      [
        {
          kind: 'update_dependency',
          dependencyId: refs.psp,
          provider: 'Stripe',
          operations: [
            { name: 'charge', timeout: '5s', retries: 2, idempotent: true, failureModes: ['declined'] },
            { name: 'refund' }
          ]
        }
      ],
      next
    ).next;
    const dependency = updated.dependencies![0]!;
    expect(dependency).toMatchObject({ name: 'Payments', provider: 'Stripe', description: 'The payment provider.' });
    expect(dependency.operations.map(({ id: _id, ...rest }) => rest)).toEqual([
      { name: 'charge', timeout: '5s', retries: 2, idempotent: true, failureModes: ['declined'] },
      { name: 'refund' }
    ]);
    expect(dependency.operations.map((o) => o.id)).not.toContain(before);
  });

  it('links a project definition once and unlinks it, refusing an unknown kind', () => {
    const { next } = shop();
    const linked = run(
      [
        { kind: 'link_project_definition', definitionKind: 'resource', id: 'lib-db' },
        { kind: 'link_project_definition', definitionKind: 'resource', id: 'lib-db' },
        { kind: 'link_project_definition', definitionKind: 'persona', id: 'lib-admin' }
      ],
      next
    ).next;
    expect(linked.resourceRefs).toEqual(['lib-db']);
    expect(linked.personaRefs).toEqual(['lib-admin']);
    const unlinked = run([{ kind: 'unlink_project_definition', definitionKind: 'resource', id: 'lib-db' }], linked).next;
    expect(unlinked.resourceRefs).toEqual([]);
    expect(unlinked.personaRefs).toEqual(['lib-admin']);
    expect(() => run([{ kind: 'link_project_definition', definitionKind: 'surface', id: 'x' }], next)).toThrow(
      /definitionKind must be one of/
    );
  });

  it('adds a parameter bound to a state path and to a value set, and updates its description', () => {
    const { next, refs } = shop();
    const added = run(
      [
        {
          kind: 'add_parameter',
          ref: 'qty',
          surfaceId: refs.cart,
          actionId: refs.add,
          name: 'qty',
          type: 'number',
          required: true,
          description: 'How many.',
          bindToStatePath: 'cart.items'
        },
        {
          kind: 'add_parameter',
          surfaceId: refs.cart,
          actionId: refs.add,
          name: 'size',
          type: 'enum',
          required: false,
          description: 'Which size.',
          valueSetId: refs.sizes
        }
      ],
      next
    );
    const [qty, size] = added.next.surfaces[0]!.actions[0]!.parameters;
    expect(qty).toMatchObject({ name: 'qty', bindToStatePath: 'cart.items', description: 'How many.' });
    expect(size).toMatchObject({ name: 'size', valueSetId: refs.sizes });
    const updated = run(
      [{ kind: 'update_parameter', surfaceId: refs.cart, actionId: refs.add, parameterId: added.refs.qty, description: 'How many items.' }],
      added.next
    ).next;
    expect(updated.surfaces[0]!.actions[0]!.parameters[0]).toMatchObject({ description: 'How many items.', bindToStatePath: 'cart.items' });
    // Renamed and retyped, and unbound with null.
    const unbound = run(
      [
        {
          kind: 'update_parameter',
          surfaceId: refs.cart,
          actionId: refs.add,
          parameterId: added.refs.qty,
          patch: { name: 'count', type: 'string', bindToStatePath: null }
        }
      ],
      updated
    ).next.surfaces[0]!.actions[0]!.parameters[0]!;
    expect(unbound).toMatchObject({ name: 'count', type: 'string', description: 'How many items.' });
    expect(unbound.bindToStatePath).toBeUndefined();
  });

  it('adds an outcome with its condition, its effects under fresh ids, and its description', () => {
    const { next, refs } = shop();
    const { next: withOutcome, refs: outcomeRefs } = run(
      [
        {
          kind: 'add_action_outcome',
          ref: 'declined',
          surfaceId: refs.cart,
          actionId: refs.pay,
          name: 'Declined',
          outcomeKind: 'rejected',
          description: 'The bank says no.',
          condition: { left: 'cart.items', operator: 'greater_than', right: 9 },
          effects: [{ type: 'show_message', message: 'Card declined.', description: 'x' }]
        }
      ],
      next
    );
    const [outcome] = withOutcome.surfaces[0]!.actions[1]!.outcomes!;
    expect(outcome).toMatchObject({
      id: outcomeRefs.declined,
      name: 'Declined',
      kind: 'rejected',
      description: 'The bank says no.',
      condition: { left: 'cart.items', operator: 'greater_than', right: 9 }
    });
    expect(outcome!.effects).toEqual([{ id: expect.any(String), type: 'show_message', message: 'Card declined.', description: 'x' }]);
  });

  it('moves an action and a surface down and up, and refuses any other direction', () => {
    const { next, refs } = shop();
    const down = run([{ kind: 'move_action', surfaceId: refs.cart, actionId: refs.add, direction: 'down' }], next).next;
    expect(actionNames(down)).toEqual(['Pay', 'Add item']);
    const up = run([{ kind: 'move_action', surfaceId: refs.cart, actionId: refs.add, direction: 'up' }], down).next;
    expect(actionNames(up)).toEqual(['Add item', 'Pay']);
    const moved = run([{ kind: 'move_surface', surfaceId: refs.cart, direction: 'down' }], next).next;
    expect(moved.surfaces.map((s) => s.name)).toEqual(['Thanks', 'Cart']);
    expect(() => run([{ kind: 'move_surface', surfaceId: refs.cart, direction: 'left' }], next)).toThrow(
      'direction must be "up" or "down"'
    );
  });

  it('aims a transition effect at a surface created earlier in the same batch, and refuses an unknown one', () => {
    const { next, refs } = run([
      { kind: 'add_surface', ref: 'cart', name: 'Cart', type: 'screen', description: 'x' },
      { kind: 'add_surface', ref: 'thanks', name: 'Thanks', type: 'screen', description: 'x' },
      { kind: 'add_action', ref: 'pay', surfaceRef: 'cart', name: 'Pay', intent: 'x' },
      { kind: 'add_effect', surfaceRef: 'cart', actionRef: 'pay', effect: { type: 'transition_surface', targetRef: 'thanks', description: 'x' } }
    ]);
    const [effect] = next.surfaces[0]!.actions[0]!.effects;
    expect(effect).toMatchObject({ type: 'transition_surface', target: refs.thanks });
    expect('targetRef' in effect!).toBe(false);
    expect(() =>
      run([
        { kind: 'add_surface', ref: 'cart', name: 'Cart', type: 'screen', description: 'x' },
        { kind: 'add_action', ref: 'pay', surfaceRef: 'cart', name: 'Pay', intent: 'x' },
        { kind: 'add_effect', surfaceRef: 'cart', actionRef: 'pay', effect: { type: 'transition_surface', targetRef: 'nowhere' } }
      ])
    ).toThrow('unknown targetRef "nowhere"');
  });

  it('adds an entity with its fields', () => {
    const { next } = run([
      {
        kind: 'add_entity',
        namespace: 'order',
        description: 'An order.',
        fields: [
          { name: 'total', type: 'number', description: 'Total.' },
          { name: 'paid', type: 'boolean', description: 'Paid.' }
        ]
      }
    ]);
    expect(next.entities[0]!.fields.map((f) => [f.name, f.type])).toEqual([
      ['total', 'number'],
      ['paid', 'boolean']
    ]);
  });

  it('updates a resource from its flat, nested and patch forms alike', () => {
    const { next, refs } = run([
      {
        kind: 'add_resource',
        ref: 'db',
        resource: { name: 'Orders', kind: 'relational_db', provider: 'Postgres', scope: 'cloud', description: 'x' }
      }
    ]);
    const flat = run([{ kind: 'update_resource', resourceId: refs.db, provider: 'MySQL', resourceKind: 'document_db' }], next).next;
    expect(flat.resources[0]).toMatchObject({ provider: 'MySQL', kind: 'document_db', name: 'Orders' });
    const nested = run([{ kind: 'update_resource', resourceId: refs.db, resource: { name: 'Sales', kind: 'key_value' } }], next).next;
    expect(nested.resources[0]).toMatchObject({ name: 'Sales', kind: 'key_value', provider: 'Postgres' });
    const patched = run([{ kind: 'update_resource', resourceId: refs.db, patch: { location: 'eu-west-1' } }], next).next;
    expect(patched.resources[0]).toMatchObject({ location: 'eu-west-1', name: 'Orders' });
  });

  it('refuses an update whose patch is not an object', () => {
    const { next, refs } = shop();
    for (const patch of ['name', ['name'], null]) {
      expect(() => run([{ kind: 'update_event', eventId: refs.paid, patch }], next)).toThrow('"patch" must be an object');
    }
  });

  it('puts a transition on the action when the op names one, on the surface otherwise, and updates it there', () => {
    const { next, refs } = shop();
    const { next: wired, refs: t } = run(
      [
        { kind: 'add_transition', ref: 'onPay', surfaceId: refs.cart, actionId: refs.pay, target: refs.done, label: 'Paid' },
        { kind: 'add_transition', ref: 'back', surfaceId: refs.cart, target: refs.done, label: 'Leave' }
      ],
      next
    );
    const cart = wired.surfaces[0]!;
    expect(cart.transitions.map((x) => [x.id, x.label])).toEqual([[t.back, 'Leave']]);
    expect(cart.actions[1]!.transitions.map((x) => [x.id, x.label])).toEqual([[t.onPay, 'Paid']]);
    // Named by its ref in the same batch, the action still gets it.
    const byRef = run(
      [
        { kind: 'add_surface', ref: 's', name: 'S', type: 'screen', description: 'x' },
        { kind: 'add_action', ref: 'a', surfaceRef: 's', name: 'A', intent: 'x' },
        { kind: 'add_transition', surfaceRef: 's', actionRef: 'a', targetRef: 's', label: 'Again' }
      ]
    ).next.surfaces[0]!;
    expect(byRef.transitions).toEqual([]);
    expect(byRef.actions[0]!.transitions.map((x) => x.label)).toEqual(['Again']);
    const relabelled = run(
      [{ kind: 'update_transition', surfaceId: refs.cart, actionId: refs.pay, transitionId: t.onPay, label: 'Settled', description: 'After paying.' }],
      wired
    ).next.surfaces[0]!;
    expect(relabelled.actions[1]!.transitions[0]).toMatchObject({ label: 'Settled', description: 'After paying.' });
    expect(relabelled.transitions[0]!.label).toBe('Leave');
    const removed = run([{ kind: 'remove_transition', surfaceId: refs.cart, actionId: refs.pay, transitionId: t.onPay }], wired).next
      .surfaces[0]!;
    expect(removed.actions[1]!.transitions).toEqual([]);
    expect(removed.transitions.map((x) => x.label)).toEqual(['Leave']);
  });

  it('keeps a transition effect that names its target directly', () => {
    const { next, refs } = shop();
    const added = run(
      [{ kind: 'add_effect', surfaceId: refs.cart, actionId: refs.pay, effect: { type: 'transition_surface', target: refs.done, description: 'x' } }],
      next
    ).next;
    expect(added.surfaces[0]!.actions[1]!.effects[0]).toMatchObject({ type: 'transition_surface', target: refs.done });
  });

  it('changes a rule\'s condition, and refuses to change a rule\'s effect as if it were the action\'s own', () => {
    const { next, refs } = shop();
    const { next: guarded, refs: r } = run(
      [
        {
          kind: 'add_action_rule',
          ref: 'empty',
          surfaceId: refs.cart,
          actionId: refs.pay,
          rule: {
            category: 'validation',
            description: 'Nothing to pay.',
            condition: { left: 'cart.items', operator: 'equals', right: 0 },
            effect: { type: 'block_action', reason: 'Empty.', description: 'x' }
          }
        }
      ],
      next
    );
    const moved = run(
      [
        {
          kind: 'update_action_rule',
          surfaceId: refs.cart,
          actionId: refs.pay,
          ruleId: r.empty,
          condition: { left: 'cart.items', operator: 'lower_than', right: 1 }
        }
      ],
      guarded
    ).next;
    const rule = moved.surfaces[0]!.actions[1]!.rules.find((x) => x.id === r.empty)!;
    expect(rule.condition).toEqual({ left: 'cart.items', operator: 'lower_than', right: 1 });
    expect(rule).toMatchObject({ category: 'validation', description: 'Nothing to pay.' });
    const effectId = rule.effect.id;
    expect(() =>
      run([{ kind: 'update_effect', surfaceId: refs.cart, actionId: refs.pay, effectId, patch: { reason: 'x' } }], guarded)
    ).toThrow(/is the effect of rule .* not one of the action's own effects/);
  });

  it('refuses to change an outcome\'s effect as if it were the action\'s own', () => {
    const { next, refs } = shop();
    const withOutcome = run(
      [
        {
          kind: 'add_action_outcome',
          surfaceId: refs.cart,
          actionId: refs.pay,
          name: 'Declined',
          outcomeKind: 'rejected',
          effects: [{ type: 'show_message', message: 'Declined.', description: 'x' }]
        }
      ],
      next
    ).next;
    const effectId = withOutcome.surfaces[0]!.actions[1]!.outcomes![0]!.effects![0]!.id;
    expect(() =>
      run([{ kind: 'update_effect', surfaceId: refs.cart, actionId: refs.pay, effectId, patch: { message: 'x' } }], withOutcome)
    ).toThrow(/is an effect of outcome .* \("Declined"\)/);
  });

  it('subscribes an action to an event and unsubscribes it with null or an empty name', () => {
    const { next, refs } = shop();
    const subscribed = run([{ kind: 'update_action', surfaceId: refs.cart, actionId: refs.add, triggeredByEvent: 'order.paid' }], next).next;
    expect(subscribed.surfaces[0]!.actions[0]!.triggeredByEvent).toBe('order.paid');
    for (const clear of [null, '']) {
      const cleared = run([{ kind: 'update_action', surfaceId: refs.cart, actionId: refs.add, triggeredByEvent: clear }], subscribed).next;
      expect(cleared.surfaces[0]!.actions[0]!.triggeredByEvent).toBeUndefined();
    }
  });

  it('sets an action\'s invariant relaxation and clears it with null', () => {
    const { next, refs } = shop();
    const relaxation = { invariantIds: ['inv-1'], rationale: 'Repair action.' };
    const relaxed = run([{ kind: 'update_action', surfaceId: refs.cart, actionId: refs.add, invariantRelaxation: relaxation }], next).next;
    expect(relaxed.surfaces[0]!.actions[0]!.invariantRelaxation).toEqual(relaxation);
    const cleared = run([{ kind: 'update_action', surfaceId: refs.cart, actionId: refs.add, invariantRelaxation: null }], relaxed).next;
    expect(cleared.surfaces[0]!.actions[0]!.invariantRelaxation).toBeUndefined();
  });

  it('updates a surface\'s name, type and presentation flag', () => {
    const { next, refs } = shop();
    const updated = run(
      [{ kind: 'update_surface', surfaceId: refs.done, name: 'Receipt', type: 'modal', presentation: true }],
      next
    ).next;
    expect(updated.surfaces[1]).toMatchObject({ name: 'Receipt', type: 'modal', presentation: true, description: 'Done.' });
  });

  it('nests a surface under another with update_surface, and refuses to nest it under itself', () => {
    const { next, refs } = shop();
    const nested = run([{ kind: 'update_surface', surfaceId: refs.done, parentSurfaceId: refs.cart }], next).next;
    expect(nested.surfaces.find((x) => x.id === refs.done)?.parentSurfaceId).toBe(refs.cart);
    expect(() => run([{ kind: 'update_surface', surfaceId: refs.cart, parentSurfaceId: refs.cart }], next)).toThrow(/update_surface: /);
  });

  it('adds an event with its payload fields, and one with an empty payload without any', () => {
    const { next } = run([
      { kind: 'add_event', name: 'order.viewed', description: 'x', payloadSchema: [] },
      { kind: 'add_event', name: 'order.paid', description: 'x', payloadSchema: [{ name: 'amount', type: 'number', required: true, description: 'Paid.' }] }
    ]);
    expect(next.events?.[0] && 'payloadSchema' in next.events[0]).toBe(false);
    expect(next.events?.[1]?.payloadSchema).toEqual([{ name: 'amount', type: 'number', required: true, description: 'Paid.' }]);
  });

  it('keeps every detail a dependency operation and a resource are added with', () => {
    const { next } = run([
      {
        kind: 'add_dependency',
        name: 'Mail',
        description: 'x',
        operations: [{ name: 'send', description: 'Send.', timeout: '3s', retries: 1, idempotent: false, failureModes: ['bounce'] }]
      },
      {
        kind: 'add_resource',
        resource: {
          name: 'Orders',
          kind: 'relational_db',
          provider: 'Postgres',
          scope: 'cloud',
          description: 'x',
          location: 'eu-west-1',
          database: 'shop',
          container: 'orders',
          field: 'total'
        }
      }
    ]);
    const [operation] = next.dependencies![0]!.operations;
    expect(operation).toMatchObject({ name: 'send', description: 'Send.', timeout: '3s', retries: 1, idempotent: false, failureModes: ['bounce'] });
    expect(next.resources[0]).toMatchObject({ location: 'eu-west-1', database: 'shop', container: 'orders', field: 'total' });
  });

  it('names every created element by the op that created it, and every minted id by its op', () => {
    const { created, mintIdToOp, refs } = shop();
    expect(created.map((c) => [c.op, c.kind])).toEqual([
      [0, 'surface'],
      [1, 'surface'],
      [2, 'state_definition'],
      [3, 'value_set'],
      [4, 'action'],
      [5, 'action'],
      [6, 'event'],
      [7, 'dependency']
    ]);
    expect(mintIdToOp.get(refs.cart!)).toBe(0);
    expect(mintIdToOp.get(refs.psp!)).toBe(7);
  });
});
