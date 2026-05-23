import { describe, expect, it } from 'vitest';
import type { Action } from '../entities/Action';
import type { Persona } from '../entities/Persona';
import {
  asActionId,
  asParameterId,
  asPersonaId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';
import {
  applyPersonaToParameters,
  applyPersonaToSnapshot
} from './PersonaApplier';

const persona: Persona = {
  id: asPersonaId('p'),
  name: 'Verified premium',
  stateOverrides: [
    { path: asStatePath('user.authenticated'), value: true },
    { path: asStatePath('user.emailVerified'), value: true },
    { path: asStatePath('cart.subtotal'), value: 9999 }
  ],
  parameterOverrides: [
    { parameterName: 'email', value: 'a@b.com' },
    { parameterName: 'method', value: 'card' },
    { parameterName: 'unrelated', value: 'ignore-me' }
  ]
};

const action: Action = {
  id: asActionId('c'),
  name: 'Place order',
  intent: '',
  parameters: [
    { id: asParameterId('p1'), name: 'email', type: 'string', required: true },
    { id: asParameterId('p2'), name: 'method', type: 'enum', required: true }
  ],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: []
};

describe('PersonaApplier', () => {
  it('writes every state override into the snapshot', () => {
    const snapshot = applyPersonaToSnapshot(persona, { other: 'untouched' });
    expect(snapshot).toMatchObject({
      other: 'untouched',
      user: { authenticated: true, emailVerified: true },
      cart: { subtotal: 9999 }
    });
  });

  it('only fills parameters that exist on the action', () => {
    const params = applyPersonaToParameters(persona, action, {});
    expect(params).toEqual({ email: 'a@b.com', method: 'card' });
    expect(params).not.toHaveProperty('unrelated');
  });

  it('lets manual parameter values override persona defaults', () => {
    const params = applyPersonaToParameters(persona, action, {
      email: 'manual@b.com'
    });
    expect(params.email).toBe('manual@b.com');
    expect(params.method).toBe('card');
  });
});
