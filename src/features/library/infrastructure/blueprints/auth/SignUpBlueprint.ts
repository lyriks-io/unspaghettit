import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { AUTH_BLUEPRINT_IDS, authPersonas, authResources } from './shared';

export const signUpBlueprint: SurfaceBlueprint = {
  id: AUTH_BLUEPRINT_IDS.signUp,
  name: 'Sign up',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'Create-account flow with email validation, terms acceptance, and password strength.',
  description:
    'A complete sign-up surface. Validates the email format, enforces password strength, requires Terms acceptance (compliance), blocks duplicate accounts, and emits an account-created event. Wires transitions to Sign in (existing user) and Verify email (next step).',
  platforms: ['web', 'mobile'],
  tags: ['register', 'create-account', 'terms', 'gdpr', 'password-strength'],
  siblings: [AUTH_BLUEPRINT_IDS.signIn, AUTH_BLUEPRINT_IDS.verifyEmail],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const usersResourceId = asResourceId('library-auth-res-users');

    const transitions = [
      linkTargets.get(AUTH_BLUEPRINT_IDS.signIn) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.signIn)!,
        label: 'Already have an account? Sign in'
      },
      linkTargets.get(AUTH_BLUEPRINT_IDS.verifyEmail) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.verifyEmail)!,
        label: 'Verify your email'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Sign up',
        type: 'screen',
        description:
          'Create a new customer account from email and password. The flow gates on email format, password strength, terms acceptance, and uniqueness.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.email'),
            type: 'string',
            defaultValue: '',
            description: 'Email of the new account. Bound from the "email" parameter.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.exists'),
            type: 'boolean',
            defaultValue: false,
            description: 'Whether an account already exists for this email.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('form.emailValid'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of the email format check.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('form.passwordStrong'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of the password-strength check.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('form.termsAccepted'),
            type: 'boolean',
            defaultValue: false,
            description: 'True once the user has ticked the Terms of Service box.'
          }
        ],
        rules: [
          {
            id: asRuleId(ids()),
            category: 'business',
            condition: { left: asStatePath('user.authenticated'), operator: 'is_true' },
            effect: {
              id: asEffectId(ids()),
              type: 'show_message',
              message: 'You already have an account.',
              tone: 'info'
            },
            description:
              'Surface-level guard: signed-in users have no business creating a second account on this surface.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'form.termsAccepted is observable',
            condition: { left: asStatePath('form.termsAccepted'), operator: 'exists' },
            message: 'Terms-accepted flag must always be present.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Create account',
            intent: 'Create a new customer account from email and password.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'email',
                type: 'string',
                required: true,
                description: 'New user email address. Bound to user.email so downstream rules and actions can read the value the user typed.',
                resourceId: usersResourceId,
                bindToStatePath: asStatePath('user.email'),
                validations: [{ type: 'email' }, { type: 'non_empty' }]
              },
              {
                id: asParameterId(ids()),
                name: 'password',
                type: 'string',
                required: true,
                description: 'New user password.',
                validations: [{ type: 'non_empty' }, { type: 'min_length', value: 8 }]
              },
              {
                id: asParameterId(ids()),
                name: 'acceptTerms',
                type: 'boolean',
                required: true,
                defaultValue: false,
                description: 'Must be true. Bound to form.termsAccepted so the compliance rule reads the actual checkbox value before evaluating.',
                bindToStatePath: asStatePath('form.termsAccepted')
              }
            ],
            requiredStates: [
              asStatePath('form.emailValid'),
              asStatePath('form.passwordStrong'),
              asStatePath('form.termsAccepted'),
              asStatePath('user.exists')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: { left: asStatePath('form.termsAccepted'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Accept the Terms of Service to continue.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('form.emailValid'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Enter a valid email address.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: { left: asStatePath('form.passwordStrong'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Password must be at least 8 characters with letters and numbers.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: { left: asStatePath('user.exists'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'An account with this email already exists. Sign in instead.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('user.authenticated'),
                value: true
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('user.account.created')
              },
              ...(linkTargets.get(AUTH_BLUEPRINT_IDS.verifyEmail)
                ? [
                    {
                      id: asEffectId(ids()),
                      type: 'transition_surface' as const,
                      target: linkTargets.get(AUTH_BLUEPRINT_IDS.verifyEmail)!
                    }
                  ]
                : [])
            ],
            emittedEvents: [asEventName('user.account.created')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Email already taken',
                description:
                  'A new visitor tries to sign up with an address that already has an account.',
                stateOverrides: [
                  { path: asStatePath('user.exists'), value: true },
                  { path: asStatePath('form.emailValid'), value: true },
                  { path: asStatePath('form.passwordStrong'), value: true },
                  { path: asStatePath('form.termsAccepted'), value: true }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'existing@example.com' },
                  { parameterName: 'password', value: 'Welcome2026!' },
                  { parameterName: 'acceptTerms', value: true }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Terms not accepted',
                description: 'Form filled but the visitor has not ticked the Terms box.',
                stateOverrides: [
                  { path: asStatePath('user.exists'), value: false },
                  { path: asStatePath('form.emailValid'), value: true },
                  { path: asStatePath('form.passwordStrong'), value: true },
                  { path: asStatePath('form.termsAccepted'), value: false }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'new@example.com' },
                  { parameterName: 'password', value: 'Welcome2026!' },
                  { parameterName: 'acceptTerms', value: false }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Weak password',
                description: 'Visitor picks a password that fails the strength check.',
                stateOverrides: [
                  { path: asStatePath('user.exists'), value: false },
                  { path: asStatePath('form.emailValid'), value: true },
                  { path: asStatePath('form.passwordStrong'), value: false },
                  { path: asStatePath('form.termsAccepted'), value: true }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'new@example.com' },
                  { parameterName: 'password', value: 'short' },
                  { parameterName: 'acceptTerms', value: true }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Everything passes. Account is created, action transitions to Verify email.',
                stateOverrides: [
                  { path: asStatePath('user.exists'), value: false },
                  { path: asStatePath('form.emailValid'), value: true },
                  { path: asStatePath('form.passwordStrong'), value: true },
                  { path: asStatePath('form.termsAccepted'), value: true }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'new@example.com' },
                  { parameterName: 'password', value: 'Welcome2026!' },
                  { parameterName: 'acceptTerms', value: true }
                ]
              }
            ]
          }
        ]
      },
      resources: authResources,
      personas: authPersonas
    };
  }
};
