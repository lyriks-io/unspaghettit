import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

export const onboardingWizardBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.onboarding.wizard'),
  name: 'Onboarding wizard',
  category: 'onboarding',
  surfaceType: 'workflow',
  summary: 'Multi-step welcome flow: profile, preferences, finish.',
  description:
    'A linear three-step wizard for new users. Each step gates on the previous one; the final step marks the user as onboarded and emits an event analytics can listen to.',
  platforms: ['web', 'mobile'],
  tags: ['onboarding', 'wizard', 'first-run', 'profile'],
  build: ({ ids, ownSurfaceId }) => {
    const profileResourceId = asResourceId('library-onboarding-res-profile');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Onboarding wizard',
        type: 'workflow',
        description:
          'Three-step welcome: 1) profile, 2) preferences, 3) finish. State machine progresses through onboarding.step.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('onboarding.step'),
            type: 'enum',
            enumValues: ['profile', 'preferences', 'finish'],
            defaultValue: 'profile'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.fullName'),
            type: 'string',
            defaultValue: ''
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.onboarded'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('preferences.theme'),
            type: 'enum',
            enumValues: ['light', 'dark', 'system'],
            defaultValue: 'system'
          }
        ],
        rules: [
          {
            id: asRuleId(ids()),
            category: 'security',
            condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
            effect: {
              id: asEffectId(ids()),
              type: 'block_action',
              reason: 'Sign in to continue your onboarding.'
            },
            description: 'Surface-level gate. Every wizard step requires authentication.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'onboarding.step is observable',
            condition: { left: asStatePath('onboarding.step'), operator: 'exists' },
            message: 'Wizard step must always be present.'
          }
        ],
        transitions: [],
        actions: [
          {
            id: asActionId(ids()),
            name: 'Save profile',
            intent: 'Capture the user full name and advance to preferences.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'fullName',
                type: 'string',
                required: true,
                description: 'Display name. Bound to user.fullName.',
                resourceId: profileResourceId,
                bindToStatePath: asStatePath('user.fullName'),
                validations: [
                  { type: 'non_empty' },
                  { type: 'min_length', value: 2 },
                  { type: 'max_length', value: 80 }
                ]
              }
            ],
            requiredStates: [asStatePath('onboarding.step'), asStatePath('user.fullName')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('onboarding.step'),
                  operator: 'not_equals',
                  right: 'profile'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'You are not on the profile step.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('user.fullName'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Full name is required.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: {
                  left: asStatePath('user.fullName'),
                  operator: 'contains',
                  right: '@'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Use a real name, not an email address.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('onboarding.step'),
                value: 'preferences'
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('onboarding.profile.saved')
              }
            ],
            emittedEvents: [asEventName('onboarding.profile.saved')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Wrong step',
                description: 'User is on preferences but somehow triggers profile-save.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('onboarding.step'), value: 'preferences' }
                ],
                parameterOverrides: [{ parameterName: 'fullName', value: 'Anna' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Email instead of name',
                description: 'User pastes an email. Compliance rule blocks.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('onboarding.step'), value: 'profile' }
                ],
                parameterOverrides: [{ parameterName: 'fullName', value: 'a@b.co' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Save preferences',
            intent: 'Capture theme preference and advance to finish.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'theme',
                type: 'enum',
                enumValues: ['light', 'dark', 'system'],
                required: true,
                description: 'UI theme. Bound to preferences.theme.',
                resourceId: profileResourceId,
                bindToStatePath: asStatePath('preferences.theme')
              }
            ],
            requiredStates: [asStatePath('onboarding.step'), asStatePath('preferences.theme')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('onboarding.step'),
                  operator: 'not_equals',
                  right: 'preferences'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Complete the profile step first.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('preferences.theme'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Pick a theme.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in required.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('onboarding.step'),
                value: 'finish'
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('onboarding.preferences.saved')
              }
            ],
            emittedEvents: [asEventName('onboarding.preferences.saved')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Finish onboarding',
            intent: 'Mark the user as onboarded and exit the wizard.',
            parameters: [],
            requiredStates: [asStatePath('onboarding.step')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('onboarding.step'),
                  operator: 'not_equals',
                  right: 'finish'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Complete the previous steps first.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in required.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('user.onboarded'),
                value: true
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('onboarding.completed')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Welcome aboard!',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('onboarding.completed')],
            transitions: []
          }
        ]
      },
      resources: [
        {
          id: profileResourceId,
          name: 'User profiles (Postgres)',
          description: 'User profile record. Name, preferences, onboarding state.',
          kind: 'relational_db',
          provider: 'PostgreSQL',
          scope: 'cloud',
          location: 'eu-west',
          database: 'identity',
          container: 'user_profiles',
          field: undefined,
          sensitivity: 'confidential',
          containsPii: true,
          complianceTags: ['gdpr'],
          accessMode: 'read_write',
          authentication: 'iam_role',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'until account deletion + 30 days',
          owner: 'identity-team'
        }
      ]
    };
  }
};
