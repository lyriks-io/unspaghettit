import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const SUPPORT_IDS = {
  helpCenter: 'library.support.help_center',
  ticket: 'library.support.ticket',
  contact: 'library.support.contact'
} as const;

const helpCenter = defineBrick({
  id: SUPPORT_IDS.helpCenter,
  name: 'Help center',
  category: 'support',
  surfaceType: 'screen',
  summary: 'Searchable knowledge base with category browse and article open.',
  description:
    'The self-serve support entry point. Search validates a non-empty query; opening an article requires a valid id.',
  surfaceName: 'Help center',
  surfaceDescription: 'Search and browse help articles by category.',
  tags: ['support', 'help', 'knowledge-base', 'search', 'faq'],
  siblings: [{ id: SUPPORT_IDS.ticket, label: 'Contact support' }],
  states: [
    { path: 'help.query', type: 'string', default: '', description: 'Current search query.' },
    { path: 'help.resultCount', type: 'number', default: 0, description: 'Matching articles.' },
    { path: 'help.category', type: 'enum', default: 'getting-started', description: 'Active category.', enumValues: ['getting-started', 'billing', 'account', 'api'] }
  ],
  invariants: [
    { name: 'Result count is non-negative', path: 'help.resultCount', op: 'greater_than', value: -1, message: 'Result count can never be negative.' }
  ],
  actions: [
    {
      name: 'Search articles',
      intent: 'Search the knowledge base.',
      emits: 'help.searched',
      roles: ['primary'],
      params: [
        { name: 'query', type: 'string', description: 'Search text.', bindTo: 'help.query', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 200 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Searching help articles.', tone: 'info' } }]
    },
    {
      name: 'Open article',
      intent: 'Open a help article by id.',
      emits: 'help.article.opened',
      roles: ['entry'],
      params: [
        { name: 'articleId', type: 'string', description: 'Article id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Article opened.', tone: 'info' } }]
    }
  ]
});

const ticket = defineBrick({
  id: SUPPORT_IDS.ticket,
  name: 'Support ticket',
  category: 'support',
  surfaceType: 'screen',
  summary: 'Create, reply to, and resolve a support ticket with agent gating.',
  description:
    'The ticket detail surface. Replies are blocked on resolved tickets; only agents can resolve, so a customer cannot close their own case.',
  surfaceName: 'Ticket',
  surfaceDescription: 'Track a support request through its lifecycle.',
  tags: ['support', 'ticket', 'helpdesk'],
  siblings: [{ id: SUPPORT_IDS.contact, label: 'Contact form' }],
  states: [
    { path: 'ticket.status', type: 'enum', default: 'open', description: 'Ticket status.', enumValues: ['open', 'pending', 'resolved'] },
    { path: 'ticket.priority', type: 'enum', default: 'normal', description: 'Ticket priority.', enumValues: ['low', 'normal', 'high', 'urgent'] },
    { path: 'ticket.messageCount', type: 'number', default: 0, description: 'Messages on the ticket.' },
    { path: 'session.role', type: 'enum', default: 'member', description: 'Role of the current session.', enumValues: ['agent', 'member'] }
  ],
  invariants: [
    { name: 'Message count is non-negative', path: 'ticket.messageCount', op: 'greater_than', value: -1, message: 'Ticket message count can never be negative.' }
  ],
  actions: [
    {
      name: 'Submit ticket',
      intent: 'Open a new support ticket.',
      emits: 'support.ticket.created',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'subject', type: 'string', description: 'Ticket subject.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 120 }] },
        { name: 'body', type: 'string', description: 'Description of the issue.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 5000 }] },
        { name: 'priority', type: 'enum', description: 'Priority.', enumValues: ['low', 'normal', 'high', 'urgent'], bindTo: 'ticket.priority' }
      ],
      rules: [{ category: 'business', description: 'Seed the message count.', set: { path: 'ticket.messageCount', value: 1 } }]
    },
    {
      name: 'Reply',
      intent: 'Add a reply to the ticket.',
      emits: 'support.ticket.replied',
      roles: ['primary'],
      requiredStates: ['ticket.status'],
      params: [
        { name: 'body', type: 'string', description: 'Reply text.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 5000 }] }
      ],
      rules: [
        { category: 'business', when: { path: 'ticket.status', op: 'equals', value: 'resolved' }, block: 'This ticket is resolved. Reopen it to reply.' }
      ]
    },
    {
      name: 'Resolve',
      intent: 'Mark the ticket resolved.',
      emits: 'support.ticket.resolved',
      roles: ['primary'],
      requiredStates: ['session.role'],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only agents can resolve tickets.' },
        { category: 'business', description: 'Set the ticket to resolved.', set: { path: 'ticket.status', value: 'resolved' } }
      ]
    }
  ]
});

const contact = defineBrick({
  id: SUPPORT_IDS.contact,
  name: 'Contact form',
  category: 'support',
  surfaceType: 'screen',
  summary: 'Name / email / message form with a required privacy consent gate.',
  description:
    'A classic contact form. Submission validates every field and is blocked until the visitor accepts the privacy notice.',
  surfaceName: 'Contact us',
  surfaceDescription: 'Send a message to the team with an explicit consent step.',
  tags: ['support', 'contact', 'form', 'consent', 'gdpr'],
  states: [
    { path: 'contact.consent', type: 'boolean', default: false, description: 'Whether the privacy notice was accepted.' },
    { path: 'contact.submitted', type: 'boolean', default: false, description: 'True after a successful send.' }
  ],
  invariants: [
    { name: 'Submitted flag is observable', path: 'contact.submitted', op: 'exists', message: 'The submitted flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Send message',
      intent: 'Submit the contact form.',
      emits: 'contact.message.sent',
      roles: ['primary'],
      requiredStates: ['contact.consent'],
      params: [
        { name: 'name', type: 'string', description: 'Sender name.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'email', type: 'email', description: 'Reply-to email.', validations: [{ type: 'non_empty' }, { type: 'email' }] },
        { name: 'message', type: 'string', description: 'Message body.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 2000 }] },
        { name: 'consent', type: 'boolean', description: 'Privacy notice acceptance.', bindTo: 'contact.consent' }
      ],
      rules: [
        { category: 'compliance', when: { path: 'contact.consent', op: 'is_false' }, block: 'Accept the privacy notice to send your message.' },
        { category: 'business', description: 'Mark the form submitted.', set: { path: 'contact.submitted', value: true } }
      ]
    }
  ]
});

export const supportBlueprints: readonly SurfaceBlueprint[] = [helpCenter, ticket, contact];
