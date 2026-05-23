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

export const resetPasswordBlueprint: SurfaceBlueprint = {
  id: AUTH_BLUEPRINT_IDS.resetPassword,
  name: 'Reset password',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'Forgot-password request and token-gated new-password flow.',
  description:
    'Two actions: Request reset (sends a token-bearing email. Fail-open to avoid account enumeration) and Set new password (requires a valid, non-expired token plus a strong new password). Wires back to Sign in.',
  platforms: ['web', 'mobile'],
  tags: ['forgot-password', 'reset', 'token', 'password', 'enumeration'],
  siblings: [AUTH_BLUEPRINT_IDS.signIn],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const tokensResourceId = asResourceId('library-auth-res-tokens');
    const usersResourceId = asResourceId('library-auth-res-users');

    const transitions = [
      linkTargets.get(AUTH_BLUEPRINT_IDS.signIn) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(AUTH_BLUEPRINT_IDS.signIn)!,
        label: 'Back to sign in'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Reset password',
        type: 'screen',
        description:
          'Forgot-password flow. Request a reset link, then submit a new password using the token from the email.',
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
            description: 'Email entered for the reset request. Bound from "email".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('form.emailValid'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('reset.token'),
            type: 'string',
            defaultValue: '',
            description: 'Reset token entered by the user. Bound from "token".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('reset.tokenValid'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of validating the reset token against the cache.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('reset.tokenExpired'),
            type: 'boolean',
            defaultValue: true,
            description: 'True when the token has aged past its TTL.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('reset.passwordStrong'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of the password-strength check on the new password.'
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'reset.tokenValid is observable',
            condition: { left: asStatePath('reset.tokenValid'), operator: 'exists' },
            message: 'Token-valid flag must always be present.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Request reset',
            intent: 'Send a password reset link to the user email if the account exists.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'email',
                type: 'string',
                required: true,
                description: 'Email address to receive the reset link. Bound to user.email.',
                resourceId: usersResourceId,
                bindToStatePath: asStatePath('user.email'),
                validations: [{ type: 'email' }, { type: 'non_empty' }]
              }
            ],
            requiredStates: [asStatePath('form.emailValid')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('form.emailValid'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Enter a valid email address.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('password.reset_requested')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'If an account exists with that email, a reset link is on its way.',
                tone: 'info'
              }
            ],
            emittedEvents: [asEventName('password.reset_requested')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Valid email',
                description: 'Visitor enters a well-formed email; reset request is sent fail-open.',
                stateOverrides: [{ path: asStatePath('form.emailValid'), value: true }],
                parameterOverrides: [{ parameterName: 'email', value: 'user@example.com' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Malformed email',
                description: 'Visitor enters something that is not an email. Validation rule blocks.',
                stateOverrides: [{ path: asStatePath('form.emailValid'), value: false }],
                parameterOverrides: [{ parameterName: 'email', value: 'not-an-email' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Set new password',
            intent: 'Set a new password using the reset token from the email.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'token',
                type: 'string',
                required: true,
                description: 'Single-use reset token delivered by email. Bound to reset.token.',
                resourceId: tokensResourceId,
                bindToStatePath: asStatePath('reset.token'),
                validations: [{ type: 'non_empty' }, { type: 'min_length', value: 32 }]
              },
              {
                id: asParameterId(ids()),
                name: 'newPassword',
                type: 'string',
                required: true,
                description: 'New password to set.',
                validations: [{ type: 'non_empty' }, { type: 'min_length', value: 8 }]
              }
            ],
            requiredStates: [
              asStatePath('reset.tokenValid'),
              asStatePath('reset.tokenExpired'),
              asStatePath('reset.passwordStrong')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: { left: asStatePath('reset.tokenExpired'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'This reset link has expired. Request a new one.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('reset.tokenValid'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'This reset link is invalid.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: { left: asStatePath('reset.passwordStrong'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'New password must be at least 8 characters with letters and numbers.'
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
                event: asEventName('password.reset_completed')
              },
              ...(linkTargets.get(AUTH_BLUEPRINT_IDS.signIn)
                ? [
                    {
                      id: asEffectId(ids()),
                      type: 'transition_surface' as const,
                      target: linkTargets.get(AUTH_BLUEPRINT_IDS.signIn)!
                    }
                  ]
                : [])
            ],
            emittedEvents: [asEventName('password.reset_completed')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Token expired',
                description: 'Reset link is past its TTL. Security rule blocks.',
                stateOverrides: [
                  { path: asStatePath('reset.tokenValid'), value: true },
                  { path: asStatePath('reset.tokenExpired'), value: true },
                  { path: asStatePath('reset.passwordStrong'), value: true }
                ],
                parameterOverrides: [
                  {
                    parameterName: 'token',
                    value: 'expired-token-1234567890123456789012'
                  },
                  { parameterName: 'newPassword', value: 'NewPass2026!' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Invalid token',
                description: 'Reset link does not match anything in the cache.',
                stateOverrides: [
                  { path: asStatePath('reset.tokenValid'), value: false },
                  { path: asStatePath('reset.tokenExpired'), value: false },
                  { path: asStatePath('reset.passwordStrong'), value: true }
                ],
                parameterOverrides: [
                  {
                    parameterName: 'token',
                    value: 'tampered-token-12345678901234567890ab'
                  },
                  { parameterName: 'newPassword', value: 'NewPass2026!' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Weak new password',
                description: 'Token is valid but the chosen new password fails the strength check.',
                stateOverrides: [
                  { path: asStatePath('reset.tokenValid'), value: true },
                  { path: asStatePath('reset.tokenExpired'), value: false },
                  { path: asStatePath('reset.passwordStrong'), value: false }
                ],
                parameterOverrides: [
                  {
                    parameterName: 'token',
                    value: 'valid-token-12345678901234567890abcdef'
                  },
                  { parameterName: 'newPassword', value: 'short' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Valid token, strong password. Reset succeeds and the action transitions to Sign in.',
                stateOverrides: [
                  { path: asStatePath('reset.tokenValid'), value: true },
                  { path: asStatePath('reset.tokenExpired'), value: false },
                  { path: asStatePath('reset.passwordStrong'), value: true }
                ],
                parameterOverrides: [
                  {
                    parameterName: 'token',
                    value: 'valid-token-12345678901234567890abcdef'
                  },
                  { parameterName: 'newPassword', value: 'NewPass2026!' }
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
