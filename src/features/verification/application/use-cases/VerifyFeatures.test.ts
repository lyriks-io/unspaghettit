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

  it('runs bounded model checking when asked and includes the invariant check', async () => {
    const verify = verifyFeaturesUseCase({
      features: fakeRepo([feature('f1')]),
      index: staticBehavioralIndexReader([])
    });

    const report = await verify({ modelCheck: { maxDepth: 4, maxStates: 100 } });
    expect(report.features[0]!.checks.some((c) => c.id === 'invariants')).toBe(true);
  });
});
