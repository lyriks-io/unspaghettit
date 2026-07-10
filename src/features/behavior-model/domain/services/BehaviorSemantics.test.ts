import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import { asEventName } from '../value-objects/EventName';
import { asActionId, asEffectId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { actionEmittedEvents, actionStateReads, actionStateWrites } from './BehaviorSemantics';

const baseAction = (): Action => ({
  id: asActionId('action'),
  name: 'Update cart',
  intent: 'Update one cart line',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
});

describe('BehaviorSemantics', () => {
  it('finds reads and writes in collection effects', () => {
    const action: Action = {
      ...baseAction(),
      effects: [
        {
          id: asEffectId('update'),
          type: 'update_list_item',
          path: asStatePath('cart.lines'),
          where: {
            field: 'productId',
            equals: { kind: 'state', path: asStatePath('selection.productId') }
          },
          field: 'quantity',
          value: { kind: 'state', path: asStatePath('selection.quantity') }
        }
      ]
    };

    expect(actionStateWrites(action).map(String)).toEqual(['cart.lines']);
    expect(actionStateReads(action).map(String)).toEqual([
      'cart.lines',
      'selection.productId',
      'selection.quantity'
    ]);
  });

  it('includes rule and blocked-effect emissions', () => {
    const action: Action = {
      ...baseAction(),
      rules: [
        {
          id: 'rule' as never,
          category: 'business',
          effect: {
            id: asEffectId('rule-event'),
            type: 'emit_event',
            event: asEventName('cart.updated')
          }
        }
      ],
      onBlockedEffects: [
        {
          id: asEffectId('blocked-event'),
          type: 'emit_event',
          event: asEventName('cart.update_blocked')
        }
      ]
    };

    expect(actionEmittedEvents(action).map(String)).toEqual([
      'cart.update_blocked',
      'cart.updated'
    ]);
  });
});

