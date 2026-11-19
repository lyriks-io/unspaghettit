import type { Feature } from '../entities/Feature';
import {
  asActionId,
  asEffectId,
  asFeatureId,
  asInvariantId,
  asReachabilityGoalId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asSurfaceId
} from '../value-objects/ids';
import { asStatePath } from '../value-objects/StatePath';

/**
 * A small feature to disable things in: validating an element, where the rule
 * "An unassigned viewer cannot validate" guards the validation and an
 * always-true statement says a viewer never validates. Two scenarios test the
 * validation, a third replays it before reopening.
 */
export const VALIDATION = {
  feature: 'feat-validation',
  surface: 'srf-element',
  validate: 'act-validate',
  reopen: 'act-reopen',
  viewerRule: 'rule-viewer-cannot-validate',
  reopenRule: 'rule-reopen-allowed',
  editorScenario: 'scn-editor-validates',
  viewerScenario: 'scn-viewer-refused',
  reopenScenario: 'scn-reopen-after-validation',
  invariant: 'inv-viewer-never-validates',
  goal: 'goal-validated'
} as const;

export const validationFeature = (): Feature => ({
  id: asFeatureId(VALIDATION.feature),
  name: 'Validate an element',
  description: 'A person validates an element of the specification.',
  surfaces: [
    {
      id: asSurfaceId(VALIDATION.surface),
      name: 'Element',
      type: 'screen',
      description: 'One element of the specification.',
      stateDefinitions: [
        {
          id: asStateDefinitionId('sd-role'),
          path: asStatePath('session.role'),
          type: 'enum',
          enumValues: ['editor', 'viewer'],
          defaultValue: 'editor',
          description: 'Who is signed in.'
        },
        {
          id: asStateDefinitionId('sd-validated'),
          path: asStatePath('element.validated'),
          type: 'boolean',
          defaultValue: false,
          description: 'Whether the element is validated.'
        }
      ],
      actions: [
        {
          id: asActionId(VALIDATION.validate),
          name: 'Validate an element',
          intent: 'Validate the element.',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId(VALIDATION.viewerRule),
              category: 'permissions',
              condition: { left: asStatePath('session.role'), operator: 'equals', right: 'viewer' },
              effect: { id: asEffectId('eff-viewer-block'), type: 'block_action', reason: 'An unassigned viewer cannot validate.' },
              description: 'An unassigned viewer cannot validate.'
            }
          ],
          invariants: [],
          effects: [
            { id: asEffectId('eff-validated'), type: 'set_state', path: asStatePath('element.validated'), value: true, description: 'The element reads validated.' }
          ],
          emittedEvents: [],
          transitions: [],
          scenarios: [
            {
              id: asScenarioId(VALIDATION.editorScenario),
              name: 'An editor validates',
              description: 'An editor is signed in.',
              stateOverrides: [],
              parameterOverrides: [],
              expectedStatus: 'success',
              expectedAssertions: [{ path: asStatePath('element.validated'), operator: 'is_true', description: 'Validated.' }]
            },
            {
              id: asScenarioId(VALIDATION.viewerScenario),
              name: 'Without sign-in a viewer validates nothing',
              description: 'A viewer is signed in.',
              stateOverrides: [{ path: asStatePath('session.role'), value: 'viewer' }],
              parameterOverrides: [],
              expectedStatus: 'blocked'
            }
          ]
        },
        {
          id: asActionId(VALIDATION.reopen),
          name: 'Reopen the element',
          intent: 'Take a validation back.',
          parameters: [],
          requiredStates: [],
          rules: [
            {
              id: asRuleId(VALIDATION.reopenRule),
              category: 'business',
              effect: { id: asEffectId('eff-reopen-allow'), type: 'allow_action', description: 'Anyone who validates may reopen.' },
              description: 'Reopening is always allowed.'
            }
          ],
          invariants: [],
          effects: [
            { id: asEffectId('eff-reopened'), type: 'set_state', path: asStatePath('element.validated'), value: false, description: 'The element reads open again.' }
          ],
          emittedEvents: [],
          transitions: [],
          scenarios: [
            {
              id: asScenarioId(VALIDATION.reopenScenario),
              name: 'Reopen after a validation',
              description: 'The element was validated first.',
              stateOverrides: [],
              parameterOverrides: [],
              steps: [{ actionId: asActionId(VALIDATION.validate), parameterOverrides: [] }],
              expectedStatus: 'success',
              expectedAssertions: [{ path: asStatePath('element.validated'), operator: 'is_false', description: 'Open again.' }]
            }
          ]
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
  events: [],
  featureInvariants: [
    {
      id: asInvariantId(VALIDATION.invariant),
      name: 'A viewer never validates',
      condition: {
        kind: 'any',
        conditions: [
          { left: asStatePath('session.role'), operator: 'not_equals', right: 'viewer' },
          { left: asStatePath('element.validated'), operator: 'is_false' }
        ]
      },
      message: 'A viewer validated an element.',
      description: 'Only an editor validates.'
    }
  ],
  reachabilityGoals: [
    {
      id: asReachabilityGoalId(VALIDATION.goal),
      name: 'An element can be validated',
      kind: 'reachable',
      condition: { left: asStatePath('element.validated'), operator: 'is_true' },
      description: 'Validation is reachable.'
    }
  ],
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z'
});

export const ADRIEN = { by: 'Adrien', at: '2026-11-18T10:00:00.000Z', reason: 'Testing the validation without it' } as const;
