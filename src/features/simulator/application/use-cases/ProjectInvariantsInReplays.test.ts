import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Invariant } from '$features/behavior-model/domain/entities/Invariant';
import type { StateDefinition } from '$features/behavior-model/domain/entities/StateDefinition';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { FeatureRepository } from '$features/behavior-model/application/ports/FeatureRepository';
import { staticBehavioralIndexReader } from '$features/verification/infrastructure/persistence/StaticBehavioralIndexReader';
import { verifyFeaturesUseCase } from '$features/verification/application/use-cases/VerifyFeatures';
import { runScenariosUseCase } from './RunScenarios';
import { simulateActionUseCase } from './SimulateAction';

/**
 * A project rule (an order is shipped only once paid) is held by every replay
 * of a feature's examples, not only by the step-by-step simulation: a scenario
 * that ships an unpaid order fails on it, and a dry run of the same action is
 * refused, while the same scenario on a paid order passes.
 */

const decl = (path: string, type: StateDefinition['type'], defaultValue: unknown, extra = {}) =>
  ({ id: `sd-${path}`, path, type, defaultValue, ...extra }) as unknown as StateDefinition;

const ship: Action = {
  id: 'a-ship',
  name: 'Ship the order',
  intent: 'Ship the order',
  parameters: [],
  requiredStates: [],
  rules: [{ id: 'r-allow', category: 'business', effect: { id: 'e-allow', type: 'allow_action' } }],
  invariants: [],
  effects: [{ id: 'e-ship', type: 'set_state', path: 'order.status', value: { kind: 'literal', value: 'shipped' } }],
  emittedEvents: [],
  transitions: [],
  scenarios: [
    {
      id: 'sc-unpaid',
      name: 'An unpaid order ships',
      stateOverrides: [],
      parameterOverrides: [],
      expectedStatus: 'success'
    },
    {
      id: 'sc-paid',
      name: 'A paid order ships',
      stateOverrides: [{ path: 'payment.captured', value: true }],
      parameterOverrides: [],
      expectedStatus: 'success'
    }
  ]
} as unknown as Action;

const feature = (id: string, states: StateDefinition[], actions: Action[]): Feature =>
  ({
    id,
    name: id,
    surfaces: [
      {
        id: `s-${id}`,
        name: 'Screen',
        type: 'screen',
        stateDefinitions: states,
        actions,
        rules: [],
        invariants: [],
        transitions: []
      } as unknown as Surface
    ],
    personas: [],
    resources: [],
    entities: [],
    featureInvariants: [],
    reachabilityGoals: [],
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z'
  }) as unknown as Feature;

// The shipping feature knows the order; the payment lives in another feature.
const shipping = feature(
  'shipping',
  [decl('order.status', 'enum', 'draft', { enumValues: ['draft', 'shipped'] })],
  [ship]
);
const payments = feature('payments', [decl('payment.captured', 'boolean', false)], []);
const paidBeforeShipped: Invariant = {
  id: 'pi-paid',
  name: 'A shipped order is paid',
  condition: {
    kind: 'any',
    conditions: [
      { kind: 'not', condition: { left: 'order.status', operator: 'equals', right: 'shipped' } },
      { left: 'payment.captured', operator: 'is_true' }
    ]
  },
  message: 'A shipped order is paid'
} as unknown as Invariant;

describe('every replay of the examples holds the project invariants', () => {
  const run = runScenariosUseCase();

  it('a scenario that breaks a project invariant fails on it', () => {
    const out = run({ feature: shipping, projectFeatures: [payments], projectInvariants: [paidBeforeShipped] });
    const unpaid = out.results.find((r) => r.scenarioId === 'sc-unpaid');
    const paid = out.results.find((r) => r.scenarioId === 'sc-paid');
    expect(unpaid?.pass).toBe(false);
    expect(unpaid?.actualStatus).toBe('blocked');
    expect(paid?.pass).toBe(true);
  });

  it('the same scenarios pass when the project declares no such rule', () => {
    const out = run({ feature: shipping, projectFeatures: [payments] });
    expect(out.results.every((r) => r.pass)).toBe(true);
  });

  it('a dry run of the action is refused on the project invariant', () => {
    const result = simulateActionUseCase()({
      feature: shipping,
      surfaceId: 's-shipping' as never,
      actionId: 'a-ship' as never,
      snapshot: {},
      parameters: {},
      projectFeatures: [payments],
      projectInvariants: [paidBeforeShipped]
    });
    expect(result.status).toBe('blocked');
  });
});

describe('verify holds the project invariants in its scenarios', () => {
  const repo = (features: readonly Feature[]): FeatureRepository =>
    ({
      async list() {
        return features.map((f) => ({ id: f.id, name: f.name }));
      },
      async get(id: string) {
        return features.find((f) => f.id === id) ?? null;
      },
      async save() {},
      async delete() {}
    }) as unknown as FeatureRepository;

  it('a feature whose scenario ships an unpaid order does not pass', async () => {
    const verify = verifyFeaturesUseCase({
      features: repo([shipping, payments]),
      index: staticBehavioralIndexReader([])
    });
    const report = await verify({
      featureIds: [shipping.id],
      projectFeatures: [shipping, payments],
      projectInvariants: [paidBeforeShipped],
      prove: false
    });
    const verdict = report.features.find((f) => f.featureId === shipping.id);
    expect(report.passed).toBe(false);
    expect(JSON.stringify(verdict)).toContain('An unpaid order ships');
  });
});
