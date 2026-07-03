import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

/**
 * Settings bricks: the account-management surfaces almost every product grows
 * into. Each links to its siblings so applying two of them wires up the
 * settings sub-navigation automatically.
 */
export const SETTINGS_IDS = {
  profile: 'library.settings.profile',
  security: 'library.settings.security',
  notifications: 'library.settings.notifications',
  appearance: 'library.settings.appearance',
  apiKeys: 'library.settings.api_keys',
  team: 'library.settings.team'
} as const;

const profile = defineBrick({
  id: SETTINGS_IDS.profile,
  name: 'Profile settings',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Edit display name, bio, and avatar with validation and a read-only lock.',
  description:
    'The "who am I" settings surface. Binds the display name and bio into state, validates length, and respects a read-only lock so managed accounts can be frozen.',
  surfaceName: 'Profile',
  surfaceDescription: 'Edit the public-facing display name, bio, and avatar for the current account.',
  tags: ['settings', 'profile', 'account', 'avatar'],
  siblings: [
    { id: SETTINGS_IDS.security, label: 'Security' },
    { id: SETTINGS_IDS.notifications, label: 'Notifications' },
    { id: SETTINGS_IDS.appearance, label: 'Appearance' }
  ],
  states: [
    { path: 'profile.displayName', type: 'string', default: '', description: 'Public display name.' },
    { path: 'profile.bio', type: 'string', default: '', description: 'Short public biography.' },
    { path: 'profile.avatarUrl', type: 'string', default: '', description: 'URL of the avatar image.' },
    { path: 'profile.editable', type: 'boolean', default: true, description: 'False when the account is managed and profile edits are locked.' },
    { path: 'profile.saved', type: 'boolean', default: false, description: 'True after a successful save.' }
  ],
  invariants: [
    { name: 'Display name slot exists', path: 'profile.displayName', op: 'exists', message: 'The profile must always carry a display-name value.' }
  ],
  actions: [
    {
      name: 'Update profile',
      intent: 'Save the display name and bio for the current account.',
      emits: 'profile.updated',
      roles: ['primary', 'persistence'],
      requiredStates: ['profile.editable'],
      params: [
        { name: 'displayName', type: 'string', description: 'New public display name.', bindTo: 'profile.displayName', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'bio', type: 'string', description: 'New biography.', required: false, defaultValue: '', bindTo: 'profile.bio', validations: [{ type: 'max_length', value: 280 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'profile.editable', op: 'is_false' }, block: 'This profile is managed and cannot be edited here.' }
      ],
      set: [{ path: 'profile.saved', value: true, description: 'Mark the profile as saved.' }]
    },
    {
      name: 'Set avatar',
      intent: 'Point the account avatar at a new image URL.',
      emits: 'profile.avatar.changed',
      roles: ['primary'],
      params: [
        { name: 'avatarUrl', type: 'url', description: 'Publicly reachable image URL.', bindTo: 'profile.avatarUrl', validations: [{ type: 'url' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Avatar updated.', tone: 'success' } }]
    }
  ]
});

const security = defineBrick({
  id: SETTINGS_IDS.security,
  name: 'Account security',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Change password, toggle two-factor, and require re-authentication for sensitive edits.',
  description:
    'Security settings with a re-authentication gate: password changes and 2FA toggles are blocked until the user has re-entered their current password in this session.',
  surfaceName: 'Security',
  surfaceDescription: 'Manage the password and two-factor authentication for the current account.',
  tags: ['settings', 'security', 'password', '2fa', 'mfa'],
  siblings: [
    { id: SETTINGS_IDS.profile, label: 'Profile' },
    { id: SETTINGS_IDS.notifications, label: 'Notifications' }
  ],
  states: [
    { path: 'security.reauthenticated', type: 'boolean', default: false, description: 'True once the user has re-entered their current password this session.' },
    { path: 'security.twoFactorEnabled', type: 'boolean', default: false, description: 'Whether TOTP two-factor is active.' },
    { path: 'security.passwordChanged', type: 'boolean', default: false, description: 'True after a successful password change.' }
  ],
  invariants: [
    { name: 'Re-auth flag is observable', path: 'security.reauthenticated', op: 'exists', message: 'The re-authentication flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Change password',
      intent: 'Set a new password after the user re-authenticates.',
      emits: 'security.password.changed',
      roles: ['primary', 'persistence'],
      requiredStates: ['security.reauthenticated'],
      params: [
        { name: 'newPassword', type: 'string', description: 'The new password.', validations: [{ type: 'non_empty' }, { type: 'min_length', value: 12 }] }
      ],
      rules: [
        { category: 'security', when: { path: 'security.reauthenticated', op: 'is_false' }, block: 'Re-enter your current password before changing it.' }
      ],
      set: [{ path: 'security.passwordChanged', value: true }]
    },
    {
      name: 'Toggle two-factor',
      intent: 'Enable or disable TOTP two-factor authentication.',
      emits: 'security.two_factor.toggled',
      roles: ['primary'],
      params: [
        { name: 'enabled', type: 'boolean', description: 'Whether to enable two-factor.', bindTo: 'security.twoFactorEnabled' }
      ],
      rules: [
        { category: 'security', when: { path: 'security.reauthenticated', op: 'is_false' }, block: 'Re-authenticate before changing two-factor settings.' }
      ],
      set: [{ path: 'security.twoFactorEnabled', value: true, description: 'Reflect the toggle. Bound param carries the real value.' }]
    }
  ]
});

const notifications = defineBrick({
  id: SETTINGS_IDS.notifications,
  name: 'Notification preferences',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Per-channel notification toggles with a global mute switch.',
  description:
    'Lets a user choose which channels (email, push, SMS) receive which notifications, with a master mute that suppresses everything.',
  surfaceName: 'Notifications',
  surfaceDescription: 'Choose which notification channels are enabled for the current account.',
  tags: ['settings', 'notifications', 'email', 'push', 'preferences'],
  siblings: [
    { id: SETTINGS_IDS.profile, label: 'Profile' },
    { id: SETTINGS_IDS.security, label: 'Security' }
  ],
  states: [
    { path: 'notifications.email', type: 'boolean', default: true, description: 'Email notifications enabled.' },
    { path: 'notifications.push', type: 'boolean', default: true, description: 'Push notifications enabled.' },
    { path: 'notifications.muted', type: 'boolean', default: false, description: 'Master mute; suppresses all channels.' },
    { path: 'notifications.frequency', type: 'enum', default: 'realtime', description: 'Digest cadence.', enumValues: ['realtime', 'daily', 'weekly'] }
  ],
  invariants: [
    { name: 'Mute flag is observable', path: 'notifications.muted', op: 'exists', message: 'The mute flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Set channel',
      intent: 'Enable or disable a single notification channel.',
      emits: 'notifications.channel.changed',
      roles: ['primary'],
      params: [
        { name: 'channel', type: 'enum', description: 'Which channel to change.', enumValues: ['email', 'push', 'sms'] },
        { name: 'enabled', type: 'boolean', description: 'On or off.' }
      ],
      rules: [
        { category: 'business', when: { path: 'notifications.muted', op: 'is_true' }, block: 'Unmute notifications before changing individual channels.' }
      ]
    },
    {
      name: 'Set digest frequency',
      intent: 'Choose how often batched notifications are delivered.',
      emits: 'notifications.frequency.changed',
      roles: ['primary'],
      params: [
        { name: 'frequency', type: 'enum', description: 'Delivery cadence.', enumValues: ['realtime', 'daily', 'weekly'], bindTo: 'notifications.frequency' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Digest cadence updated.', tone: 'success' } }]
    }
  ]
});

const appearance = defineBrick({
  id: SETTINGS_IDS.appearance,
  name: 'Appearance',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Theme and density preferences with an instant-preview hint.',
  description:
    'Theme (light/dark/system) and layout density preferences. Purely client-side; no permission gate needed.',
  surfaceName: 'Appearance',
  surfaceDescription: 'Choose the theme and layout density for the current account.',
  tags: ['settings', 'appearance', 'theme', 'dark-mode'],
  siblings: [{ id: SETTINGS_IDS.profile, label: 'Profile' }],
  states: [
    { path: 'appearance.theme', type: 'enum', default: 'system', description: 'Colour theme.', enumValues: ['light', 'dark', 'system'] },
    { path: 'appearance.density', type: 'enum', default: 'comfortable', description: 'Layout density.', enumValues: ['comfortable', 'compact'] }
  ],
  invariants: [
    { name: 'Theme is always set', path: 'appearance.theme', op: 'exists', message: 'A theme value must always be present.' }
  ],
  actions: [
    {
      name: 'Set theme',
      intent: 'Switch the colour theme.',
      emits: 'appearance.theme.changed',
      roles: ['primary'],
      params: [
        { name: 'theme', type: 'enum', description: 'Colour theme.', enumValues: ['light', 'dark', 'system'], bindTo: 'appearance.theme' }
      ],
      rules: [
        { category: 'ux_feedback', when: { path: 'appearance.theme', op: 'equals', value: 'dark' }, message: { text: 'Dark mode enabled.', tone: 'info' } }
      ]
    },
    {
      name: 'Set density',
      intent: 'Switch the layout density.',
      emits: 'appearance.density.changed',
      roles: ['primary'],
      params: [
        { name: 'density', type: 'enum', description: 'Layout density.', enumValues: ['comfortable', 'compact'], bindTo: 'appearance.density' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Density updated.', tone: 'success' } }]
    }
  ]
});

const apiKeys = defineBrick({
  id: SETTINGS_IDS.apiKeys,
  name: 'API keys',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Create and revoke personal API keys, gated on an owner/admin role.',
  description:
    'Developer settings for issuing and revoking API keys. Creation and revocation are gated on the session role so members cannot mint credentials.',
  surfaceName: 'API keys',
  surfaceDescription: 'Issue and revoke API keys for programmatic access to the account.',
  tags: ['settings', 'api', 'keys', 'developer', 'tokens'],
  states: [
    { path: 'apiKeys.count', type: 'number', default: 0, description: 'Number of active keys.' },
    { path: 'apiKeys.maxKeys', type: 'number', default: 10, description: 'Hard cap on active keys.' },
    { path: 'session.role', type: 'enum', default: 'member', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'Key count is non-negative', path: 'apiKeys.count', op: 'greater_than', value: -1, message: 'The active-key count can never go below zero.' }
  ],
  actions: [
    {
      name: 'Create key',
      intent: 'Mint a new API key for the account.',
      emits: 'api_key.created',
      roles: ['primary', 'persistence'],
      requiredStates: ['apiKeys.count', 'session.role'],
      params: [
        { name: 'label', type: 'string', description: 'Human label for the key.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 60 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can create API keys.' },
        { category: 'billing_quota', when: { path: 'apiKeys.count', op: 'greater_than', value: 9 }, block: 'Key limit reached. Revoke an existing key first.' }
      ],
      set: [{ path: 'apiKeys.count', value: 1, description: 'Placeholder; real impl increments the count.' }]
    },
    {
      name: 'Revoke key',
      intent: 'Immediately revoke an API key by id.',
      emits: 'api_key.revoked',
      roles: ['destructive'],
      requiredStates: ['session.role'],
      params: [
        { name: 'keyId', type: 'string', description: 'Id of the key to revoke.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can revoke API keys.' }
      ],
      set: [{ path: 'apiKeys.count', value: 0, description: 'Placeholder; real impl decrements the count.' }]
    }
  ]
});

const team = defineBrick({
  id: SETTINGS_IDS.team,
  name: 'Team members',
  category: 'settings',
  surfaceType: 'screen',
  summary: 'Invite teammates, change roles, and remove members with owner protection.',
  description:
    'Team management surface. Invites, role changes, and removals are gated on the actor role, and the last owner cannot be demoted or removed.',
  surfaceName: 'Team',
  surfaceDescription: 'Manage who belongs to the workspace and what role they hold.',
  tags: ['settings', 'team', 'members', 'roles', 'invite'],
  siblings: [{ id: SETTINGS_IDS.apiKeys, label: 'API keys' }],
  states: [
    { path: 'team.memberCount', type: 'number', default: 1, description: 'Number of members in the workspace.' },
    { path: 'team.ownerCount', type: 'number', default: 1, description: 'Number of owners; must stay at least one.' },
    { path: 'session.role', type: 'enum', default: 'member', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'At least one owner', path: 'team.ownerCount', op: 'greater_than', value: 0, message: 'A workspace must always keep at least one owner.' }
  ],
  actions: [
    {
      name: 'Invite member',
      intent: 'Send a workspace invitation to an email address.',
      emits: 'team.member.invited',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'email', type: 'email', description: 'Invitee email address.', validations: [{ type: 'non_empty' }, { type: 'email' }] },
        { name: 'role', type: 'enum', description: 'Role to grant on join.', enumValues: ['admin', 'member'] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can invite members.' }
      ],
      set: [{ path: 'team.memberCount', value: 2, description: 'Placeholder; real impl increments once the invite is accepted.' }]
    },
    {
      name: 'Remove member',
      intent: 'Remove a member from the workspace.',
      emits: 'team.member.removed',
      roles: ['destructive'],
      requiredStates: ['session.role', 'team.ownerCount'],
      params: [
        { name: 'memberId', type: 'string', description: 'Id of the member to remove.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can remove members.' }
      ],
      set: [{ path: 'team.memberCount', value: 0, description: 'Placeholder; real impl decrements the count.' }]
    }
  ]
});

export const settingsBlueprints: readonly SurfaceBlueprint[] = [
  profile,
  security,
  notifications,
  appearance,
  apiKeys,
  team
];
