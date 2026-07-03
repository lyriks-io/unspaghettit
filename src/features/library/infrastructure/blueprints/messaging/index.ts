import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const MESSAGING_IDS = {
  chat: 'library.messaging.chat',
  inbox: 'library.messaging.inbox',
  notificationCenter: 'library.messaging.notification_center'
} as const;

const chat = defineBrick({
  id: MESSAGING_IDS.chat,
  name: 'Chat conversation',
  category: 'messaging',
  surfaceType: 'screen',
  summary: 'One-to-one or group chat with a composer, block gate, and reactions.',
  description:
    'A live conversation view. Sending is blocked on blocked conversations, the composer clears after send, and reactions require at least one message.',
  surfaceName: 'Conversation',
  surfaceDescription: 'Read and send messages within a single conversation thread.',
  tags: ['chat', 'messaging', 'dm', 'conversation'],
  siblings: [{ id: MESSAGING_IDS.inbox, label: 'Inbox' }],
  states: [
    { path: 'chat.messageCount', type: 'number', default: 0, description: 'Messages in this conversation.' },
    { path: 'chat.unreadCount', type: 'number', default: 0, description: 'Unread messages for the viewer.' },
    { path: 'chat.blocked', type: 'boolean', default: false, description: 'True when this conversation is blocked.' },
    { path: 'chat.draft', type: 'string', default: '', description: 'The current composer text.' }
  ],
  invariants: [
    { name: 'Message count is non-negative', path: 'chat.messageCount', op: 'greater_than', value: -1, message: 'A conversation can never have negative messages.' }
  ],
  actions: [
    {
      name: 'Send message',
      intent: 'Post a new message to the conversation.',
      emits: 'chat.message.sent',
      roles: ['primary'],
      requiredStates: ['chat.blocked'],
      params: [
        { name: 'body', type: 'string', description: 'Message text.', bindTo: 'chat.draft', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 4000 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'chat.blocked', op: 'is_true' }, block: 'This conversation is blocked.' },
        { category: 'business', description: 'Clear the composer after a successful send.', set: { path: 'chat.draft', value: '' } }
      ]
    },
    {
      name: 'Mark read',
      intent: 'Clear the unread badge for this conversation.',
      emits: 'chat.conversation.read',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Reset the unread counter.', set: { path: 'chat.unreadCount', value: 0 } }]
    }
  ]
});

const inbox = defineBrick({
  id: MESSAGING_IDS.inbox,
  name: 'Inbox',
  category: 'messaging',
  surfaceType: 'screen',
  summary: 'Threaded inbox with filters, thread selection, and archive.',
  description:
    'The list side of messaging: a filterable set of threads. Opening a thread requires a valid id; archiving requires a selected thread.',
  surfaceName: 'Inbox',
  surfaceDescription: 'Browse, filter, open, and archive conversation threads.',
  tags: ['inbox', 'messaging', 'threads', 'archive'],
  siblings: [
    { id: MESSAGING_IDS.chat, label: 'Open conversation' },
    { id: MESSAGING_IDS.notificationCenter, label: 'Notifications' }
  ],
  states: [
    { path: 'inbox.unreadCount', type: 'number', default: 0, description: 'Unread threads.' },
    { path: 'inbox.selectedThreadId', type: 'string', default: '', description: 'Currently open thread id.' },
    { path: 'inbox.filter', type: 'enum', default: 'all', description: 'Active thread filter.', enumValues: ['all', 'unread', 'archived'] }
  ],
  invariants: [
    { name: 'Unread count is non-negative', path: 'inbox.unreadCount', op: 'greater_than', value: -1, message: 'Unread threads can never be negative.' }
  ],
  actions: [
    {
      name: 'Open thread',
      intent: 'Select and open a conversation thread.',
      emits: 'inbox.thread.opened',
      roles: ['entry'],
      params: [
        { name: 'threadId', type: 'string', description: 'Thread id to open.', bindTo: 'inbox.selectedThreadId', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Thread opened.', tone: 'info' } }]
    },
    {
      name: 'Set filter',
      intent: 'Filter the thread list.',
      emits: 'inbox.filter.changed',
      roles: ['primary'],
      params: [
        { name: 'filter', type: 'enum', description: 'Thread filter.', enumValues: ['all', 'unread', 'archived'], bindTo: 'inbox.filter' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    },
    {
      name: 'Archive thread',
      intent: 'Move the selected thread to the archive.',
      emits: 'inbox.thread.archived',
      roles: ['primary'],
      requiredStates: ['inbox.selectedThreadId'],
      rules: [
        { category: 'business', when: { path: 'inbox.selectedThreadId', op: 'equals', value: '' }, block: 'Select a thread before archiving.' }
      ]
    }
  ]
});

const notificationCenter = defineBrick({
  id: MESSAGING_IDS.notificationCenter,
  name: 'Notification center',
  category: 'messaging',
  surfaceType: 'dialog_area',
  summary: 'Dropdown of notifications with mark-all-read and per-item dismiss.',
  description:
    'A compact notification tray. Marking all read resets the unread badge; dismissing removes a single item by id.',
  surfaceName: 'Notifications',
  surfaceDescription: 'Review recent notifications and clear them individually or all at once.',
  tags: ['notifications', 'messaging', 'tray', 'alerts'],
  states: [
    { path: 'notify.unread', type: 'number', default: 0, description: 'Unread notifications.' },
    { path: 'notify.total', type: 'number', default: 0, description: 'Total notifications held.' }
  ],
  invariants: [
    { name: 'Unread is non-negative', path: 'notify.unread', op: 'greater_than', value: -1, message: 'Unread notifications can never be negative.' }
  ],
  actions: [
    {
      name: 'Mark all read',
      intent: 'Clear the unread notification badge.',
      emits: 'notification.all_read',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Zero the unread counter.', set: { path: 'notify.unread', value: 0 } }]
    },
    {
      name: 'Dismiss',
      intent: 'Remove a single notification.',
      emits: 'notification.dismissed',
      roles: ['primary'],
      params: [
        { name: 'notificationId', type: 'string', description: 'Id of the notification to dismiss.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Notification dismissed.', tone: 'info' } }]
    }
  ]
});

export const messagingBlueprints: readonly SurfaceBlueprint[] = [chat, inbox, notificationCenter];
