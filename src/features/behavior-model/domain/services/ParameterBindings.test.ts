import { describe, expect, it } from 'vitest';
import type { Parameter } from '../entities/Parameter';
import { asParameterId } from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import { applyParameterBindings } from './ParameterBindings';

describe('applyParameterBindings', () => {
  it('writes bound parameter values into the snapshot', () => {
    const params: readonly Parameter[] = [
      {
        id: asParameterId('p1'),
        name: 'quantity',
        type: 'number',
        required: true,
        bindToStatePath: asStatePath('cart.itemCount')
      },
      {
        id: asParameterId('p2'),
        name: 'unbound',
        type: 'string',
        required: false
      }
    ];
    const next = applyParameterBindings(params, { quantity: 3, unbound: 'x' }, {});
    expect(next).toEqual({ cart: { itemCount: 3 } });
  });

  it('skips parameters without a value', () => {
    const params: readonly Parameter[] = [
      {
        id: asParameterId('p'),
        name: 'q',
        type: 'number',
        required: false,
        bindToStatePath: asStatePath('cart.itemCount')
      }
    ];
    const next = applyParameterBindings(params, {}, { cart: { itemCount: 0 } });
    expect(next).toEqual({ cart: { itemCount: 0 } });
  });
});
