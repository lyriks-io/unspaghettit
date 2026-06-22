import { describe, expect, it } from 'vitest';
import {
  asFeatureId,
  asReachabilityGoalId,
  asSurfaceId
} from '$features/behavior-model/domain/value-objects/ids';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import { exportFeatureToJson, importFeatureFromJson } from './FeatureJson';

const sample: Feature = {
  id: asFeatureId('e'),
  name: 'Sample',
  description: 'Hello',
  surfaces: [
    {
      id: asSurfaceId('s'),
      name: 'Surface',
      type: 'screen',
      stateDefinitions: [],
      actions: [],
      rules: [],
      invariants: [],
      transitions: []
    }
  ],
  personas: [],
  resources: [],
  entities: [],
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
};

describe('FeatureJson', () => {
  it('roundtrips an feature through export → import', () => {
    const json = exportFeatureToJson(sample);
    const back = importFeatureFromJson(json);
    expect(back).toEqual(sample);
  });

  it('preserves reachability goals through the snapshot', () => {
    const withGoal: Feature = {
      ...sample,
      reachabilityGoals: [
        {
          id: asReachabilityGoalId('g1'),
          name: 'completion stays reachable',
          kind: 'always_reachable',
          condition: { left: asStatePath('flow.done'), operator: 'is_true' },
          description: 'the user can always still finish'
        }
      ]
    };
    const back = importFeatureFromJson(exportFeatureToJson(withGoal));
    expect(back.reachabilityGoals).toEqual(withGoal.reachabilityGoals);
  });

  it('preserves an Evolution proposal on an action through the snapshot', () => {
    const withProposal: Feature = {
      ...sample,
      surfaces: [
        {
          ...sample.surfaces[0]!,
          actions: [
            {
              id: 'a' as never,
              name: 'Sign in with SSO',
              intent: 'Federated login',
              parameters: [],
              requiredStates: [],
              rules: [],
              invariants: [],
              effects: [],
              emittedEvents: [],
              transitions: [],
              evolution: { rationale: 'Competitors offer it', category: 'competitor' }
            }
          ]
        }
      ]
    };
    const back = importFeatureFromJson(exportFeatureToJson(withProposal));
    expect(back.surfaces[0]!.actions[0]!.evolution).toEqual({
      rationale: 'Competitors offer it',
      category: 'competitor'
    });
  });

  it('rejects payloads without the unspaghettit format flag', () => {
    expect(() => importFeatureFromJson('{}')).toThrow(/format/);
  });

  it('rejects unsupported versions', () => {
    const payload = JSON.stringify({ format: 'unspaghettit', version: 99, feature: sample });
    expect(() => importFeatureFromJson(payload)).toThrow(/version/);
  });

  it('rejects malformed JSON', () => {
    expect(() => importFeatureFromJson('not json')).toThrow(/Invalid JSON/);
  });
});
