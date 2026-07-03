import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const COMMUNITY_IDS = {
  forum: 'library.community.forum',
  thread: 'library.community.thread',
  moderation: 'library.community.moderation'
} as const;

const forum = defineBrick({
  id: COMMUNITY_IDS.forum,
  name: 'Forum',
  category: 'community',
  surfaceType: 'screen',
  summary: 'Category-filtered thread list with a create-thread action.',
  description:
    'The forum index. Creating a thread validates the title, body, and category; the category filter narrows the list.',
  surfaceName: 'Forum',
  surfaceDescription: 'Browse and start discussion threads.',
  tags: ['community', 'forum', 'threads', 'discussion'],
  siblings: [{ id: COMMUNITY_IDS.thread, label: 'Open thread' }],
  states: [
    { path: 'forum.threadCount', type: 'number', default: 0, description: 'Threads in view.' },
    { path: 'forum.category', type: 'enum', default: 'general', description: 'Active category.', enumValues: ['general', 'help', 'showcase', 'feedback'] }
  ],
  invariants: [
    { name: 'Thread count is non-negative', path: 'forum.threadCount', op: 'greater_than', value: -1, message: 'Thread count can never be negative.' }
  ],
  actions: [
    {
      name: 'Create thread',
      intent: 'Start a new discussion thread.',
      emits: 'community.thread.created',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'title', type: 'string', description: 'Thread title.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 160 }] },
        { name: 'body', type: 'string', description: 'Opening post.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 10000 }] },
        { name: 'category', type: 'enum', description: 'Category.', enumValues: ['general', 'help', 'showcase', 'feedback'], bindTo: 'forum.category' }
      ],
      rules: [{ category: 'business', description: 'Count the new thread.', set: { path: 'forum.threadCount', value: 1 } }]
    },
    {
      name: 'Filter category',
      intent: 'Filter threads by category.',
      emits: 'community.category.filtered',
      roles: ['primary'],
      params: [
        { name: 'category', type: 'enum', description: 'Category.', enumValues: ['general', 'help', 'showcase', 'feedback'], bindTo: 'forum.category' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    }
  ]
});

const thread = defineBrick({
  id: COMMUNITY_IDS.thread,
  name: 'Thread detail',
  category: 'community',
  surfaceType: 'screen',
  summary: 'A thread view with locked-guarded replies and upvotes.',
  description:
    'A single discussion. Replies are blocked on a locked thread; upvotes are open and emit an event.',
  surfaceName: 'Thread',
  surfaceDescription: 'Read a thread and reply or upvote.',
  tags: ['community', 'thread', 'replies', 'votes'],
  siblings: [{ id: COMMUNITY_IDS.moderation, label: 'Moderation' }],
  states: [
    { path: 'thread.replyCount', type: 'number', default: 0, description: 'Replies on the thread.' },
    { path: 'thread.locked', type: 'boolean', default: false, description: 'Whether replies are blocked.' },
    { path: 'thread.upvotes', type: 'number', default: 0, description: 'Upvotes on the opening post.' }
  ],
  invariants: [
    { name: 'Reply count is non-negative', path: 'thread.replyCount', op: 'greater_than', value: -1, message: 'Reply count can never be negative.' }
  ],
  actions: [
    {
      name: 'Reply',
      intent: 'Post a reply to the thread.',
      emits: 'community.reply.posted',
      roles: ['primary'],
      requiredStates: ['thread.locked'],
      params: [
        { name: 'body', type: 'string', description: 'Reply text.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 10000 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'thread.locked', op: 'is_true' }, block: 'This thread is locked.' }
      ]
    },
    {
      name: 'Upvote',
      intent: 'Upvote the opening post.',
      emits: 'community.thread.upvoted',
      roles: ['feedback'],
      rules: [{ category: 'ux_feedback', message: { text: 'Thanks for the vote.', tone: 'success' } }]
    }
  ]
});

const moderation = defineBrick({
  id: COMMUNITY_IDS.moderation,
  name: 'Moderation queue',
  category: 'community',
  surfaceType: 'board',
  summary: 'Approve or remove reported items, moderator-gated.',
  description:
    'A review queue for reported content. Approving and removing are moderator-only; removal also requires a reason.',
  surfaceName: 'Moderation',
  surfaceDescription: 'Review reported content and take action.',
  tags: ['community', 'moderation', 'reports', 'queue'],
  states: [
    { path: 'moderation.pending', type: 'number', default: 0, description: 'Items awaiting review.' },
    { path: 'session.role', type: 'enum', default: 'member', description: 'Role of the current session.', enumValues: ['moderator', 'member'] }
  ],
  invariants: [
    { name: 'Pending count is non-negative', path: 'moderation.pending', op: 'greater_than', value: -1, message: 'Pending count can never be negative.' }
  ],
  actions: [
    {
      name: 'Approve item',
      intent: 'Approve a reported item.',
      emits: 'moderation.item.approved',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'itemId', type: 'string', description: 'Item id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only moderators can approve items.' }
      ]
    },
    {
      name: 'Remove item',
      intent: 'Remove a reported item.',
      emits: 'moderation.item.removed',
      roles: ['destructive'],
      requiredStates: ['session.role'],
      params: [
        { name: 'itemId', type: 'string', description: 'Item id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] },
        { name: 'reason', type: 'string', description: 'Removal reason.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 500 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only moderators can remove content.' }
      ]
    }
  ]
});

export const communityBlueprints: readonly SurfaceBlueprint[] = [forum, thread, moderation];
