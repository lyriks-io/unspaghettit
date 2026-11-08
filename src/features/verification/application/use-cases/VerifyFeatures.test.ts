import { describe, expect, it } from 'vitest';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  FeatureRepository,
  FeatureSummary
} from '$features/behavior-model/application/ports/FeatureRepository';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asStateDefinitionId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import { staticBehavioralIndexReader } from '../../infrastructure/persistence/StaticBehavioralIndexReader';
import type { IndexedImplementation } from '../../domain/IndexedImplementation';
import { verifyFeaturesUseCase } from './VerifyFeatures';
import type { ProofContext, VerdictProof } from '$features/prover/ProverPort';

const feature = (id: string, updatedAt = '2026-06-01T00:00:00.000Z'): Feature => ({
  id: asFeatureId(id),
  name: `Feature ${id}`,
  surfaces: [
    {
      id: asSurfaceId(`${id}-s`),
      name: 'Main',
      type: 'screen',
      stateDefinitions: [
        {
          id: asStateDefinitionId(`${id}-d`),
          path: asStatePath('count'),
          type: 'number',
          defaultValue: 0
        }
      ],
      actions: [
        {
          id: asActionId(`${id}-a`),
          name: 'Bump',
          intent: 'increment the counter',
          parameters: [],
          requiredStates: [],
          rules: [],
          invariants: [],
          effects: [
            {
              id: asEffectId(`${id}-e`),
              type: 'set_state',
              path: asStatePath('count'),
              value: {
                kind: 'add',
                left: { kind: 'state', path: asStatePath('count') },
                right: { kind: 'literal', value: 1 }
              }
            }
          ],
          emittedEvents: [],
          transitions: []
        }
      ],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt
});

const summaryOf = (f: Feature): FeatureSummary => ({
  id: f.id,
  name: f.name,
  surfaceCount: f.surfaces.length,
  actionCount: f.surfaces.reduce((n, s) => n + s.actions.length, 0),
  createdAt: f.createdAt,
  updatedAt: f.updatedAt
});

const fakeRepo = (features: readonly Feature[]): FeatureRepository => ({
  async list() {
    return features.map(summaryOf);
  },
  async get(id) {
    return features.find((f) => f.id === id) ?? null;
  },
  async save() {},
  async delete() {}
});

describe('verifyFeaturesUseCase', () => {
  it('passes a scenario-free feature by default and reports it as checked', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify();
    expect(report.passed).toBe(true);
    expect(report.summary.featuresChecked).toBe(1);
    expect(report.features[0]!.checks.find((c) => c.id === 'scenarios')?.status).toBe('warn');
  });

  it('fails when scenarios are required but none exist', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify({ thresholds: { requireScenarios: true } });
    expect(report.passed).toBe(false);
    expect(report.summary.featuresFailed).toBe(1);
  });

  it('fails on drifted implementations when drift is gated', async () => {
    const f = feature('f1', '2026-06-10T00:00:00.000Z');
    const index: IndexedImplementation[] = [
      { key: `action:${f.surfaces[0]!.actions[0]!.id}`, status: 'implemented', auditedSpecVersion: '2026-06-01T00:00:00.000Z' }
    ];
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([f]),
      index: staticBehavioralIndexReader(index)
    });

    const warned = await verify();
    expect(warned.passed).toBe(true);
    expect(warned.drift.stale).toHaveLength(1);

    const gated = await verify({ thresholds: { allowDrift: false } });
    expect(gated.passed).toBe(false);
  });

  it('enforces project invariants during model checking', async () => {
    // The Bump action drives count 0 → 1; a project invariant "count stays
    // below 1" must therefore be reported as violated by the model checker.
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify({
      projectInvariants: [
        {
          id: 'pinv' as never,
          name: 'count stays below 1',
          condition: { left: asStatePath('count'), operator: 'lower_than', right: 1 },
          message: 'count exceeded the project ceiling',
          description: 'cross-feature ceiling'
        }
      ],
      modelCheck: { maxDepth: 3, maxStates: 50 }
    });

    const invariants = report.features[0]!.checks.find((c) => c.id === 'invariants');
    expect(invariants?.status).toBe('fail');
    expect(invariants?.items?.some((i) => i.includes('count stays below 1'))).toBe(true);
  });

  it('explores one feature over the starting state of the rest of its project', async () => {
    // "place" owns place.name, starting at "Market" and written by nobody: a
    // project rule asking for a name holds on every path of f1. Verified
    // alone, f1 used to be explored without the project's starting state, so
    // the rule read as broken by its very first step.
    const place: Feature = {
      ...feature('place'),
      surfaces: [
        {
          ...feature('place').surfaces[0]!,
          stateDefinitions: [
            {
              id: asStateDefinitionId('place-name'),
              path: asStatePath('place.name'),
              type: 'string',
              defaultValue: 'Market'
            }
          ],
          actions: []
        }
      ]
    };
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1'), place]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify({
      featureIds: [asFeatureId('f1')],
      projectFeatures: [feature('f1'), place],
      projectInvariants: [
        {
          id: 'pinv-name' as never,
          name: 'A place has a name',
          condition: {
            kind: 'all',
            conditions: [
              { left: asStatePath('place.name'), operator: 'exists' },
              { left: asStatePath('place.name'), operator: 'not_equals', right: '' }
            ]
          },
          message: 'A place exists without a name.',
          description: 'generated from the data model'
        }
      ],
      modelCheck: { maxDepth: 3, maxStates: 50 }
    });

    expect(report.features.map((f) => f.featureId)).toEqual(['f1']);
    expect(report.features[0]!.checks.find((c) => c.id === 'invariants')?.status).toBe('pass');
    expect(report.summary.invariantViolations).toBe(0);
  });

  it('runs bounded model checking when asked and includes the invariant check', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify({ modelCheck: { maxDepth: 4, maxStates: 100 } });
    expect(report.features[0]!.checks.some((c) => c.id === 'invariants')).toBe(true);
  });
});

// Criteria 20c6bfc4, 94823c0b, c5cbc26f: the verification asks the proof module first.
// The module itself (the solver behind it) is tested where it lives; here, how
// the verdict reads what it answers.
describe('verifyFeaturesUseCase with a proof module', () => {
  const settledProof = (over: Partial<VerdictProof> = {}): VerdictProof => ({
    ran: true,
    provenViolations: 0,
    unsettled: 0,
    witnessedInputs: new Map(),
    explorationPlan: {
      run: false,
      reasons: ['the solver settled every statement, action, goal and dead end within 3 steps']
    },
    checks: ({ exploration }) => ({
      ...(exploration
        ? { exploration, invariants: { id: 'invariants', label: 'Invariants', status: 'pass', detail: 'read by both' } }
        : {}),
      searches: [
        { id: 'invariants', label: 'Invariants', status: 'pass', detail: 'no violation on any path of up to 3 steps' },
        { id: 'dead-actions', label: 'Dead actions', status: 'pass', detail: 'every action runs' }
      ],
      closing: [{ id: 'solver', label: 'Solver', status: 'pass', detail: '3 questions settled for every value, none left open' }]
    }),
    ...over
  });

  it('proves every feature with its project, and skips the exploration the proof made unnecessary', async () => {
    const asked: { feature: string; context: ProofContext }[] = [];
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1'), feature('f2')]),
      index: staticBehavioralIndexReader([]),
      prove: async (f, context) => {
        asked.push({ feature: String(f.id), context });
        return settledProof();
      }
    });

    const report = await verify({ modelCheck: { maxDepth: 3, maxStates: 50 } });
    expect(asked.map((a) => a.feature)).toEqual(['f1', 'f2']);
    expect(asked[0]!.context.maxSteps).toBe(3);
    expect(asked[0]!.context.projectFeatures.map((f) => String(f.id))).toEqual(['f1', 'f2']);
    const checks = report.features[0]!.checks;
    expect(checks.find((c) => c.id === 'exploration')?.detail).toBe(
      'not run: the solver settled every statement, action, goal and dead end within 3 steps'
    );
    expect(checks.find((c) => c.id === 'bounds')).toBeUndefined();
    // The proof's own searches stand where the exploration did not run, its closing checks last.
    expect(checks.map((c) => c.id)).toEqual(['scenarios', 'invariants', 'dead-actions', 'exploration', 'maturity', 'verified', 'reachability', 'solver']);
    expect(report.summary.proof).toEqual({
      proven: 2,
      notProven: 0,
      provenViolations: 0,
      unsettled: 0,
      explorationsSkipped: 2
    });
  });

  it('runs the exploration where the proof left something open, and reads the invariants from both', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([]),
      prove: async () =>
        settledProof({ explorationPlan: { run: true, reasons: ['1 action the solver left open'] } })
    });

    const report = await verify({ modelCheck: { maxDepth: 3, maxStates: 50 } });
    const checks = report.features[0]!.checks;
    expect(checks.find((c) => c.id === 'exploration')).toBeUndefined();
    expect(checks.find((c) => c.id === 'invariants')?.detail).toBe('read by both');
    expect(checks.find((c) => c.id === 'dead-actions')?.status).toBe('pass');
    expect(report.summary.proof?.explorationsSkipped).toBe(0);
  });

  it('says nothing was proven when the proof is turned off for the run', async () => {
    let called = false;
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([]),
      prove: async () => {
        called = true;
        return settledProof();
      }
    });

    const report = await verify({ prove: false });
    expect(called).toBe(false);
    expect(report.features[0]!.checks.find((c) => c.id === 'solver')?.detail).toBe(
      'turned off for this run: nothing was proven'
    );
    expect(report.summary.proof?.notProven).toBe(1);
  });

  it('counts the violations a proof found and lets its checks fail the verdict', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([]),
      prove: async () =>
        settledProof({
          provenViolations: 1,
          checks: () => ({
            searches: [
              {
                id: 'invariants',
                label: 'Invariants',
                status: 'fail',
                detail: '1 reachable violation(s)',
                traces: [{ label: 'count stays below 3', path: ['Bump', 'Bump', 'Bump'] }]
              }
            ],
            closing: []
          })
        })
    });

    const report = await verify({});
    const invariants = report.features[0]!.checks.find((c) => c.id === 'invariants');
    expect(invariants?.status).toBe('fail');
    expect(invariants?.traces?.[0]?.path).toEqual(['Bump', 'Bump', 'Bump']);
    expect(report.summary.proof?.provenViolations).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('says nothing about proofs where no proof module is wired', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });
    const report = await verify({});
    expect(report.features[0]!.checks.find((c) => c.id === 'solver')).toBeUndefined();
    expect(report.summary.proof).toBeUndefined();
  });
});
