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
import {
  AUTH_BLUEPRINT_IDS,
  authPersonas,
  authResources
} from './shared';

export const signInBlueprint: SurfaceBlueprint = {
  id: AUTH_BLUEPRINT_IDS.signIn,
  name: 'Sign in',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'Email + password sign-in with rate limiting and account lockout.',
  description:
    'A complete sign-in surface: validates credentials, enforces a failed-attempts threshold, blocks locked accounts, and emits a signed-in event. Wires transitions to the matching Sign up, Verify email, and Reset password surfaces if those blueprints are added in the same operation.',
  platforms: ['web', 'mobile'],
  tags: ['login', 'authentication', 'rate-limit', 'lockout', 'gdpr'],
  siblings: [
    AUTH_BLUEPRINT_IDS.signUp,
    AUTH_BLUEPRINT_IDS.verifyEmail,
    AUTH_BLUEPRINT_IDS.resetPassword
  ],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const usersResourceId = asResourceId('library-auth-res-users');

    const transitions = [
      linkTargets.get(AUTH_BLUEPRINT_IDS.signUp) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.signUp)!,
        label: "Don't have an account? Sign up"
      },
      linkTargets.get(AUTH_BLUEPRINT_IDS.resetPassword) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.resetPassword)!,
        label: 'Forgot password?'
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
        name: 'Sign in',
        type: 'screen',
        description:
          'Authenticate an existing user with email and password. Failed attempts are tracked; the account is locked after 5 consecutive failures.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false,
            description: 'Whether the user has a valid session.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.email'),
            type: 'string',
            defaultValue: '',
            description: 'Email used for sign-in. Bound from the "email" parameter.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('auth.credentialsValid'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of the credentials check against the user store.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('auth.failedAttempts'),
            type: 'number',
            defaultValue: 0,
            description: 'Consecutive failed sign-in attempts on this account.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('auth.locked'),
            type: 'boolean',
            defaultValue: false,
            description: 'Set to true when failedAttempts crosses the threshold.'
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
              message: 'You are already signed in.',
              tone: 'info'
            },
            description:
              'Surface-level guard: if the user is already authenticated, the sign-in form is a no-op. Surface a hint rather than letting them re-submit.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'auth.failedAttempts is non-negative',
            condition: {
              left: asStatePath('auth.failedAttempts'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Failed-attempts counter must be ≥ 0.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Sign in',
            intent: 'Authenticate an existing user with email and password.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'email',
                type: 'string',
                required: true,
                description: 'Email used as the login identifier. Bound to user.email.',
                resourceId: usersResourceId,
                bindToStatePath: asStatePath('user.email'),
                validations: [{ type: 'email' }, { type: 'non_empty' }]
              },
              {
                id: asParameterId(ids()),
                name: 'password',
                type: 'string',
                required: true,
                description: 'Plain-text password (hashed before storage).',
                validations: [{ type: 'non_empty' }, { type: 'min_length', value: 8 }]
              }
            ],
            requiredStates: [
              asStatePath('auth.credentialsValid'),
              asStatePath('auth.failedAttempts'),
              asStatePath('auth.locked')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('auth.locked'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Account is locked. Reset your password or contact support.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: {
                  left: asStatePath('auth.failedAttempts'),
                  operator: 'greater_than',
                  right: 4
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Too many failed attempts. Try again later.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('auth.credentialsValid'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Email or password incorrect.'
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
                event: asEventName('user.signed_in')
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
            emittedEvents: [asEventName('user.signed_in')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Account is locked',
                description:
                  'Existing account that has been locked after too many failed attempts. Verifies the lockout rule fires before the credentials check.',
                stateOverrides: [
                  { path: asStatePath('auth.locked'), value: true },
                  { path: asStatePath('auth.failedAttempts'), value: 5 },
                  { path: asStatePath('auth.credentialsValid'), value: true }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'locked@example.com' },
                  { parameterName: 'password', value: 'CorrectHorse!' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Bad credentials',
                description:
                  'Account exists but the password is wrong. Verifies the validation rule fires.',
                stateOverrides: [
                  { path: asStatePath('auth.credentialsValid'), value: false },
                  { path: asStatePath('auth.failedAttempts'), value: 1 },
                  { path: asStatePath('auth.locked'), value: false }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'user@example.com' },
                  { parameterName: 'password', value: 'WrongGuess1' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Already signed in',
                description:
                  'Authenticated user lands on the sign-in surface again. Verifies the surface-level "already signed in" hint shows.',
                stateOverrides: [{ path: asStatePath('user.authenticated'), value: true }],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Valid credentials, account not locked. Action succeeds.',
                stateOverrides: [
                  { path: asStatePath('auth.credentialsValid'), value: true },
                  { path: asStatePath('auth.locked'), value: false },
                  { path: asStatePath('auth.failedAttempts'), value: 0 }
                ],
                parameterOverrides: [
                  { parameterName: 'email', value: 'user@example.com' },
                  { parameterName: 'password', value: 'CorrectHorse!' }
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
