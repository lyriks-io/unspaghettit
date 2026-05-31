import { describe, expect, it } from 'vitest';
import type { Action } from '$features/behavior-model/domain/entities/Action';
import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Surface } from '$features/behavior-model/domain/entities/Surface';
import type { Project } from '$features/projects/domain/entities/Project';
import { buildBuilderModeDashboard } from './BuilderModeDashboard';

const now = '2026-05-30T00:00:00.000Z';

const action = (overrides: Partial<Action>): Action => ({
  id: 'action-1' as never,
  name: 'Send invite',
  intent: 'Invite a teammate by email.',
  parameters: [],
  requiredStates: [],
  rules: [],
  invariants: [],
  effects: [],
  emittedEvents: [],
  transitions: [],
  scenarios: [],
  ...overrides
});

const surface = (actions: readonly Action[]): Surface => ({
  id: 'surface-1' as never,
  name: 'Team settings',
  type: 'screen',
  stateDefinitions: [],
  actions,
  rules: [],
  invariants: [],
  transitions: []
});

const feature = (actions: readonly Action[]): Feature => ({
  id: 'feature-1' as never,
  name: 'Team management',
  description: 'Manage the people who can use the workspace.',
  surfaces: [surface(actions)],
  personas: [],
  resources: [],
  entities: [],
  createdAt: now,
  updatedAt: now
});

const project = (): Project => ({
  id: 'project-1' as never,
  name: 'Workspace app',
  description: 'A small SaaS workspace.',
  featureIds: ['feature-1' as never],
  createdAt: now,
  updatedAt: now
});

describe('buildBuilderModeDashboard', () => {
  it('maps projects, model features, and actions into easy mode vocabulary', () => {
    const dashboard = buildBuilderModeDashboard([
      {
        project: project(),
        coreFeatures: [
          {
            feature: feature([action({})]),
            implementationStatus: null
          }
        ]
      }
    ]);

    const mappedProject = dashboard.projects[0];
    const mappedCoreFeature = mappedProject?.coreFeatures[0];
    const mappedFeature = mappedCoreFeature?.features[0];

    expect(mappedProject?.name).toBe('Workspace app');
    expect(mappedCoreFeature?.name).toBe('Team management');
    expect(mappedFeature?.name).toBe('Send invite');
    expect(mappedFeature?.description).toBe('Invite a teammate by email.');
    expect(mappedFeature?.implementationPercentage).toBe(0);
    // Suggestions are NOT deterministic anymore: a committed action with no
    // proposed Evolution carries no advice.
    expect(mappedFeature?.suggestions).toEqual([]);
    expect(mappedCoreFeature?.suggestions).toEqual([]);
  });

  it('surfaces the model\'s Evolutions as the core feature\'s suggestions', () => {
    const dashboard = buildBuilderModeDashboard([
      {
        project: project(),
        coreFeatures: [
          {
            feature: feature([
              action({ id: 'committed' as never, name: 'Committed feature' }),
              action({
                id: 'proposal' as never,
                name: 'Sign in with SSO',
                evolution: { rationale: 'Most competitors offer it', category: 'competitor' }
              })
            ]),
            implementationStatus: null
          }
        ]
      }
    ]);

    const core = dashboard.projects[0]?.coreFeatures[0];
    // The Evolution drives the suggestion (LLM-authored), not maturity/impl.
    expect(core?.suggestions.map((s) => s.text)).toEqual([
      'Sign in with SSO: Most competitors offer it'
    ]);
    // And the proposal is still hidden from the committed feature list.
    expect(core?.features.map((item) => item.name)).toEqual(['Committed feature']);
  });

  it('hides dismissed Evolutions from suggestions while keeping them out of the feature list', () => {
    const dashboard = buildBuilderModeDashboard([
      {
        project: project(),
        coreFeatures: [
          {
            feature: feature([
              action({ id: 'committed' as never, name: 'Committed feature' }),
              action({
                id: 'live' as never,
                name: 'Sign in with SSO',
                evolution: { rationale: 'Most competitors offer it', category: 'competitor' }
              }),
              action({
                id: 'dismissed' as never,
                name: 'Add CAPTCHA',
                evolution: { rationale: 'Already considered and rejected', dismissed: true }
              })
            ]),
            implementationStatus: null
          }
        ]
      }
    ]);

    const core = dashboard.projects[0]?.coreFeatures[0];
    // Only the live proposal shows; the dismissed tombstone is hidden.
    expect(core?.suggestions.map((s) => s.text)).toEqual([
      'Sign in with SSO: Most competitors offer it'
    ]);
    // The dismissed proposal is still an Evolution, so it never leaks into the
    // committed feature list either.
    expect(core?.features.map((item) => item.name)).toEqual(['Committed feature']);
  });
});
