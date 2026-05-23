import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import {
  asActionId,
  asEffectId,
  asEventDefinitionId,
  asFeatureId,
  asInvariantId,
  asParameterId,
  asPersonaId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { listFeatureIdsTool } from './listFeatureIds';

const surface: Surface = {
  id: asSurfaceId('s1'),
  name: 'Login',
  type: 'screen',
  stateDefinitions: [
    {
      id: asStateDefinitionId('sd1'),
      path: asStatePath('auth.email'),
      type: 'string',
      defaultValue: ''
    }
  ],
  actions: [
    {
      id: asActionId('a1'),
      name: 'Sign In',
      intent: 'Submit credentials',
      parameters: [
        {
          id: asParameterId('p1'),
          name: 'email',
          type: 'string',
          required: true
        }
      ],
      requiredStates: [],
      rules: [
        {
          id: asRuleId('r1'),
          category: 'permissions',
          condition: { left: asStatePath('auth.email'), operator: 'equals', right: '' },
          effect: { id: asEffectId('re1'), type: 'block_action', reason: 'no email' }
        }
      ],
      invariants: [
        {
          id: asInvariantId('inv1'),
          name: 'email never null',
          condition: { left: asStatePath('auth.email'), operator: 'not_equals', right: null },
          message: 'email must not be null'
        }
      ],
      effects: [
        {
          id: asEffectId('e1'),
          type: 'emit_event',
          event: asEventName('auth.signin_attempted')
        }
      ],
      emittedEvents: [asEventName('auth.signin_attempted')],
      transitions: [],
      scenarios: [
        {
          id: asScenarioId('sc1'),
          name: 'Sign in with blank email is blocked',
          stateOverrides: [],
          parameterOverrides: []
        }
      ]
    } satisfies Action
  ],
  rules: [
    {
      id: asRuleId('sr1'),
      category: 'ux_feedback',
      condition: { left: asStatePath('auth.email'), operator: 'equals', right: '' },
      effect: { id: asEffectId('sre1'), type: 'show_message', message: 'Type your email.' }
    }
  ],
  invariants: [],
  transitions: [
    {
      id: asTransitionId('t1'),
      target: asSurfaceId('s1'),
      label: 'self-loop'
    }
  ]
};

const feature: Feature = {
  id: asFeatureId('f1'),
  name: 'Auth',
  surfaces: [surface],
  personas: [
    { id: asPersonaId('per1'), name: 'Visitor', stateOverrides: [], parameterOverrides: [] }
  ],
  resources: [],
  entities: [],
  events: [
    {
      id: asEventDefinitionId('ev1'),
      name: asEventName('auth.signin_attempted')
    }
  ],
  createdAt: '2026-05-16T00:00:00.000Z',
  updatedAt: '2026-05-16T00:00:00.000Z'
};

describe('listFeatureIdsTool', () => {
  it('flattens every entity with human-readable context', () => {
    const out = listFeatureIdsTool(feature);
    expect(out.featureId).toBe('f1');
    expect(out.featureName).toBe('Auth');
    expect(out.surfaces).toHaveLength(1);
    expect(out.surfaces[0]?.name).toBe('Login');
    expect(out.actions[0]?.name).toBe('Sign In');
    expect(out.actions[0]?.surfaceName).toBe('Login');
    expect(out.states[0]?.path).toBe('auth.email');
    expect(out.parameters[0]?.name).toBe('email');
    expect(out.parameters[0]?.actionName).toBe('Sign In');
    expect(out.scenarios[0]?.name).toContain('blank email');
    expect(out.events[0]?.name).toBe('auth.signin_attempted');
    expect(out.personas[0]?.name).toBe('Visitor');
  });

  it('tags rules and invariants with their scope', () => {
    const out = listFeatureIdsTool(feature);
    const surfaceRule = out.rules.find((r) => r.scope === 'surface');
    const actionRule = out.rules.find((r) => r.scope === 'action');
    expect(surfaceRule?.category).toBe('ux_feedback');
    expect(actionRule?.category).toBe('permissions');
    expect(actionRule?.actionName).toBe('Sign In');
    const actionInvariant = out.invariants.find((i) => i.scope === 'action');
    expect(actionInvariant?.name).toBe('email never null');
  });

  it('resolves transition targets to surface names', () => {
    const out = listFeatureIdsTool(feature);
    expect(out.transitions[0]?.targetName).toBe('Login');
    expect(out.transitions[0]?.label).toBe('self-loop');
  });
});
