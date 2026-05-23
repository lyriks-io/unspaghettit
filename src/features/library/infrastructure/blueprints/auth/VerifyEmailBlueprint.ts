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

export const verifyEmailBlueprint: SurfaceBlueprint = {
  id: AUTH_BLUEPRINT_IDS.verifyEmail,
  name: 'Verify email',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'One-time-code email verification with attempt limiting and resend.',
  description:
    'Confirms email ownership using a 6-digit code. Caps the number of attempts, requires authentication, and exposes a Resend code action with implicit throttling. Wires back to Sign in.',
  platforms: ['web', 'mobile'],
  tags: ['otp', 'email', 'verification', '6-digit', 'gdpr'],
  siblings: [AUTH_BLUEPRINT_IDS.signIn, AUTH_BLUEPRINT_IDS.signUp],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const tokensResourceId = asResourceId('library-auth-res-tokens');

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
        name: 'Verify email',
        type: 'screen',
        description:
          'Enter the 6-digit code sent to the user email. Limited to 5 attempts; resend is available with a cooldown.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.emailVerified'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('verification.code'),
            type: 'string',
            defaultValue: '',
            description: 'Code typed by the user. Bound from the "code" parameter.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('verification.codeMatches'),
            type: 'boolean',
            defaultValue: false,
            description: 'Result of comparing the entered code to the cached one.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('verification.attempts'),
            type: 'number',
            defaultValue: 0,
            description: 'Consecutive failed verification attempts.'
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
              reason: 'Sign in before verifying your email.'
            },
            description: 'Surface-level gate that applies to every action here.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'verification.attempts is non-negative',
            condition: {
              left: asStatePath('verification.attempts'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Verification-attempts counter must be ≥ 0.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Verify email',
            intent: 'Confirm email ownership using the 6-digit code.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'code',
                type: 'string',
                required: true,
                description: 'The 6-digit code from the verification email. Bound to verification.code.',
                resourceId: tokensResourceId,
                bindToStatePath: asStatePath('verification.code'),
                validations: [
                  { type: 'non_empty' },
                  { type: 'length', value: 6 },
                  { type: 'alphanumeric' }
                ]
              }
            ],
            requiredStates: [
              asStatePath('verification.codeMatches'),
              asStatePath('verification.attempts')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: {
                  left: asStatePath('verification.attempts'),
                  operator: 'greater_than',
                  right: 4
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Too many failed attempts. Request a new code.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('verification.codeMatches'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'That code is incorrect.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('user.emailVerified'),
                value: true
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('user.email_verified')
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
            emittedEvents: [asEventName('user.email_verified')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Pending verification',
                description:
                  'Just signed up. Authenticated, email unverified, no failed attempts yet. The default starting point for this surface.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('user.emailVerified'), value: false },
                  { path: asStatePath('verification.codeMatches'), value: true },
                  { path: asStatePath('verification.attempts'), value: 0 }
                ],
                parameterOverrides: [{ parameterName: 'code', value: '482919' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Wrong code',
                description: 'User enters a code that does not match what was emailed.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('verification.codeMatches'), value: false },
                  { path: asStatePath('verification.attempts'), value: 1 }
                ],
                parameterOverrides: [{ parameterName: 'code', value: '111111' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Too many attempts',
                description: 'User has burned through the attempt limit; the security rule blocks further tries.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('verification.attempts'), value: 5 },
                  { path: asStatePath('verification.codeMatches'), value: true }
                ],
                parameterOverrides: [{ parameterName: 'code', value: '482919' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Resend code',
            intent: 'Send a new 6-digit verification code to the user email.',
            parameters: [],
            requiredStates: [],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'security',
                condition: {
                  left: asStatePath('verification.attempts'),
                  operator: 'greater_than',
                  right: 9
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Resend cooldown. Try again in a few minutes.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('verification.code_resent')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'A new code has been sent to your email.',
                tone: 'info'
              }
            ],
            emittedEvents: [asEventName('verification.code_resent')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Within cooldown',
                description: 'Resend triggered too soon after the previous one. The security rule blocks.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('verification.attempts'), value: 12 }
                ],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Fresh resend',
                description: 'No recent activity. The resend goes through.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('verification.attempts'), value: 0 }
                ],
                parameterOverrides: []
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
