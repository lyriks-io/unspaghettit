import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';
import { AUTH_BLUEPRINT_IDS } from './shared';

/** Auth bricks that extend the sign-in quad: MFA, sessions, and logout. */

const mfaSetup = defineBrick({
  id: 'library.auth.mfa_setup',
  name: 'Two-factor setup',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'Enroll TOTP/SMS/email 2FA with a code-verification step.',
  description:
    'The multi-factor enrollment flow. Choosing a method starts setup; entering a valid 6-digit code enables and verifies two-factor.',
  surfaceName: 'Two-factor',
  surfaceDescription: 'Add a second authentication factor to the account.',
  tags: ['auth', 'mfa', '2fa', 'totp', 'security'],
  siblings: [{ id: AUTH_BLUEPRINT_IDS.signIn, label: 'Back to sign in' }],
  states: [
    { path: 'mfa.enabled', type: 'boolean', default: false, description: 'Whether 2FA is active.' },
    { path: 'mfa.verified', type: 'boolean', default: false, description: 'Whether the setup code was verified.' },
    { path: 'mfa.method', type: 'enum', default: 'totp', description: 'Second-factor method.', enumValues: ['totp', 'sms', 'email'] }
  ],
  invariants: [
    { name: 'Enabled flag is observable', path: 'mfa.enabled', op: 'exists', message: 'The 2FA enabled flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Start setup',
      intent: 'Begin enrolling a second factor.',
      emits: 'mfa.setup.started',
      roles: ['entry'],
      params: [
        { name: 'method', type: 'enum', description: 'Second-factor method.', enumValues: ['totp', 'sms', 'email'], bindTo: 'mfa.method' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Scan the code with your authenticator app.', tone: 'info' } }]
    },
    {
      name: 'Verify code',
      intent: 'Confirm the setup with a one-time code.',
      emits: 'mfa.verified',
      roles: ['primary'],
      requiredStates: ['mfa.verified'],
      params: [
        { name: 'code', type: 'string', description: 'Six-digit code.', validations: [{ type: 'non_empty' }, { type: 'length', value: 6 }, { type: 'no_whitespace' }] }
      ],
      rules: [
        { category: 'security', when: { path: 'mfa.verified', op: 'is_true' }, block: 'Two-factor is already verified.' },
        { category: 'security', description: 'Mark the code verified.', set: { path: 'mfa.verified', value: true } },
        { category: 'security', description: 'Enable two-factor.', set: { path: 'mfa.enabled', value: true } }
      ]
    }
  ]
});

const sessions = defineBrick({
  id: 'library.auth.sessions',
  name: 'Active sessions',
  category: 'auth',
  surfaceType: 'screen',
  summary: 'List and revoke devices, protecting the current session.',
  description:
    'A device/session manager. Revoking a single session is blocked when it is the only one; revoke-all-others keeps the current session alive.',
  surfaceName: 'Sessions',
  surfaceDescription: 'Review where the account is signed in and sign devices out.',
  tags: ['auth', 'sessions', 'devices', 'security'],
  siblings: [{ id: AUTH_BLUEPRINT_IDS.signIn, label: 'Sign in' }],
  states: [
    { path: 'sessions.count', type: 'number', default: 1, description: 'Active sessions.' },
    { path: 'sessions.currentId', type: 'string', default: '', description: 'Id of the current session.' }
  ],
  invariants: [
    { name: 'At least one session', path: 'sessions.count', op: 'greater_than', value: 0, message: 'There is always at least the current session.' }
  ],
  actions: [
    {
      name: 'Revoke session',
      intent: 'Sign out a single device.',
      emits: 'session.revoked',
      roles: ['destructive'],
      requiredStates: ['sessions.count'],
      params: [
        { name: 'sessionId', type: 'string', description: 'Session id to revoke.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'security', when: { path: 'sessions.count', op: 'lower_than', value: 2 }, block: 'You cannot revoke your only session.' }
      ]
    },
    {
      name: 'Revoke all others',
      intent: 'Sign out every device except this one.',
      emits: 'session.all_others_revoked',
      roles: ['destructive'],
      rules: [
        { category: 'security', description: 'Collapse to the current session only.', set: { path: 'sessions.count', value: 1 } }
      ]
    }
  ]
});

const logout = defineBrick({
  id: 'library.auth.logout',
  name: 'Sign out',
  category: 'auth',
  surfaceType: 'dialog_area',
  summary: 'Sign out this device or everywhere, with an already-signed-out guard.',
  description:
    'A logout confirmation. Signing out is blocked when already signed out; sign-out-everywhere clears the session across devices.',
  surfaceName: 'Sign out',
  surfaceDescription: 'End the current session.',
  tags: ['auth', 'logout', 'sign-out', 'session'],
  siblings: [{ id: AUTH_BLUEPRINT_IDS.signIn, label: 'Sign in' }],
  states: [
    { path: 'session.active', type: 'boolean', default: true, description: 'Whether a session is active.' }
  ],
  invariants: [
    { name: 'Session flag is observable', path: 'session.active', op: 'exists', message: 'The session-active flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Sign out',
      intent: 'End the session on this device.',
      emits: 'user.signed_out',
      roles: ['primary'],
      requiredStates: ['session.active'],
      rules: [
        { category: 'business', when: { path: 'session.active', op: 'is_false' }, block: 'You are already signed out.' },
        { category: 'business', description: 'Clear the active session.', set: { path: 'session.active', value: false } }
      ]
    },
    {
      name: 'Sign out everywhere',
      intent: 'End the session on all devices.',
      emits: 'user.signed_out_all',
      roles: ['destructive'],
      rules: [
        { category: 'security', description: 'Clear the session across devices.', set: { path: 'session.active', value: false } }
      ]
    }
  ]
});

export const authExtraBlueprints: readonly SurfaceBlueprint[] = [mfaSetup, sessions, logout];
