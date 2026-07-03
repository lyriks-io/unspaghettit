import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const ADMIN_IDS = {
  users: 'library.admin.users',
  audit: 'library.admin.audit',
  flags: 'library.admin.flags'
} as const;

const users = defineBrick({
  id: ADMIN_IDS.users,
  name: 'User management',
  category: 'admin',
  surfaceType: 'screen',
  summary: 'Suspend users and change roles, all gated on an admin session.',
  description:
    'The back-office user table. Every mutating action is gated on the acting role, so members can view but never suspend or promote.',
  surfaceName: 'Users',
  surfaceDescription: 'Administer the accounts in the system.',
  tags: ['admin', 'users', 'roles', 'moderation'],
  siblings: [{ id: ADMIN_IDS.audit, label: 'Audit log' }],
  states: [
    { path: 'admin.userCount', type: 'number', default: 0, description: 'Total accounts.' },
    { path: 'admin.selectedUserId', type: 'string', default: '', description: 'Currently selected account.' },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'User count is non-negative', path: 'admin.userCount', op: 'greater_than', value: -1, message: 'The user count can never be negative.' }
  ],
  actions: [
    {
      name: 'Suspend user',
      intent: 'Suspend an account.',
      emits: 'admin.user.suspended',
      roles: ['destructive'],
      requiredStates: ['session.role'],
      params: [
        { name: 'userId', type: 'string', description: 'Account to suspend.', bindTo: 'admin.selectedUserId', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can suspend users.' }
      ]
    },
    {
      name: 'Change role',
      intent: 'Change the role of an account.',
      emits: 'admin.user.role_changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'userId', type: 'string', description: 'Account to update.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] },
        { name: 'role', type: 'enum', description: 'New role.', enumValues: ['owner', 'admin', 'member'] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'not_equals', value: 'owner' }, block: 'Only owners can change roles.' }
      ]
    }
  ]
});

const audit = defineBrick({
  id: ADMIN_IDS.audit,
  name: 'Audit log',
  category: 'admin',
  surfaceType: 'screen',
  summary: 'Immutable event trail with filters and a compliance-gated export.',
  description:
    'A tamper-evident record of system events. Filtering is open; exporting the trail is a compliance action gated on an admin role.',
  surfaceName: 'Audit',
  surfaceDescription: 'Inspect and export the system audit trail.',
  tags: ['admin', 'audit', 'compliance', 'log', 'security'],
  states: [
    { path: 'audit.entryCount', type: 'number', default: 0, description: 'Entries in the current view.' },
    { path: 'audit.range', type: 'enum', default: '7d', description: 'Time window.', enumValues: ['24h', '7d', '30d'] },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'Entry count is non-negative', path: 'audit.entryCount', op: 'greater_than', value: -1, message: 'The entry count can never be negative.' }
  ],
  actions: [
    {
      name: 'Filter log',
      intent: 'Narrow the audit trail by actor and time.',
      emits: 'audit.filtered',
      roles: ['primary'],
      params: [
        { name: 'actor', type: 'string', description: 'Actor to filter by.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 120 }] },
        { name: 'range', type: 'enum', description: 'Time window.', enumValues: ['24h', '7d', '30d'], bindTo: 'audit.range' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    },
    {
      name: 'Export log',
      intent: 'Export the audit trail for compliance.',
      emits: 'audit.exported',
      roles: ['async'],
      requiredStates: ['session.role'],
      params: [
        { name: 'format', type: 'enum', description: 'Export format.', enumValues: ['csv', 'json'] }
      ],
      rules: [
        { category: 'compliance', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can export the audit log.' }
      ]
    }
  ]
});

const flags = defineBrick({
  id: ADMIN_IDS.flags,
  name: 'Feature flags',
  category: 'admin',
  surfaceType: 'screen',
  summary: 'Toggle flags and set rollout percentages behind an admin gate.',
  description:
    'A feature-flag console. Toggling and rollout changes are admin-only and validate the flag key and percentage bounds.',
  surfaceName: 'Flags',
  surfaceDescription: 'Control feature rollout across the system.',
  tags: ['admin', 'flags', 'rollout', 'experiments'],
  states: [
    { path: 'flags.count', type: 'number', default: 0, description: 'Number of defined flags.' },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'Flag count is non-negative', path: 'flags.count', op: 'greater_than', value: -1, message: 'The flag count can never be negative.' }
  ],
  actions: [
    {
      name: 'Toggle flag',
      intent: 'Turn a feature flag on or off.',
      emits: 'admin.flag.toggled',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'key', type: 'string', description: 'Flag key.', validations: [{ type: 'non_empty' }, { type: 'slug' }] },
        { name: 'enabled', type: 'boolean', description: 'Whether the flag is on.' }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can toggle flags.' }
      ]
    },
    {
      name: 'Set rollout',
      intent: 'Set the rollout percentage for a flag.',
      emits: 'admin.flag.rollout_changed',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'key', type: 'string', description: 'Flag key.', validations: [{ type: 'non_empty' }, { type: 'slug' }] },
        { name: 'percent', type: 'number', description: 'Rollout percentage.', validations: [{ type: 'min', value: 0 }, { type: 'max', value: 100 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can change rollout.' }
      ]
    }
  ]
});

export const adminBlueprints: readonly SurfaceBlueprint[] = [users, audit, flags];
