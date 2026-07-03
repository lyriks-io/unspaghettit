import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const CRM_IDS = {
  contacts: 'library.crm.contacts',
  pipeline: 'library.crm.pipeline',
  leadCapture: 'library.crm.lead_capture'
} as const;

const contacts = defineBrick({
  id: CRM_IDS.contacts,
  name: 'Contacts',
  category: 'crm',
  surfaceType: 'screen',
  summary: 'Contact list with add and role-gated delete.',
  description:
    'The people table of a CRM. Adding validates name and email; deleting is gated so viewers cannot remove records.',
  surfaceName: 'Contacts',
  surfaceDescription: 'Manage the contacts in the CRM.',
  tags: ['crm', 'contacts', 'people'],
  siblings: [{ id: CRM_IDS.pipeline, label: 'Pipeline' }],
  states: [
    { path: 'contacts.count', type: 'number', default: 0, description: 'Number of contacts.' },
    { path: 'contacts.selectedId', type: 'string', default: '', description: 'Selected contact id.' },
    { path: 'session.role', type: 'enum', default: 'editor', description: 'Role of the current session.', enumValues: ['admin', 'editor', 'viewer'] }
  ],
  invariants: [
    { name: 'Contact count is non-negative', path: 'contacts.count', op: 'greater_than', value: -1, message: 'Contact count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add contact',
      intent: 'Create a new contact.',
      emits: 'crm.contact.added',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'name', type: 'string', description: 'Full name.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'email', type: 'email', description: 'Email address.', validations: [{ type: 'non_empty' }, { type: 'email' }] },
        { name: 'company', type: 'string', description: 'Company.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 120 }] }
      ],
      rules: [{ category: 'business', description: 'Count the new contact.', set: { path: 'contacts.count', value: 1 } }]
    },
    {
      name: 'Delete contact',
      intent: 'Remove a contact.',
      emits: 'crm.contact.deleted',
      roles: ['destructive'],
      requiredStates: ['session.role'],
      params: [
        { name: 'contactId', type: 'string', description: 'Contact id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'viewer' }, block: 'Viewers cannot delete contacts.' }
      ]
    }
  ]
});

const pipeline = defineBrick({
  id: CRM_IDS.pipeline,
  name: 'Deal pipeline',
  category: 'crm',
  surfaceType: 'board',
  summary: 'Kanban of deals across stages with add and move.',
  description:
    'A sales pipeline board. Adding a deal validates the title and value and counts it; moving a deal changes its stage.',
  surfaceName: 'Pipeline',
  surfaceDescription: 'Track deals across pipeline stages.',
  tags: ['crm', 'pipeline', 'deals', 'sales', 'kanban'],
  states: [
    { path: 'pipeline.dealCount', type: 'number', default: 0, description: 'Deals on the board.' },
    { path: 'pipeline.stage', type: 'enum', default: 'lead', description: 'Selected deal stage.', enumValues: ['lead', 'qualified', 'proposal', 'won', 'lost'] }
  ],
  invariants: [
    { name: 'Deal count is non-negative', path: 'pipeline.dealCount', op: 'greater_than', value: -1, message: 'Deal count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add deal',
      intent: 'Create a new deal.',
      emits: 'crm.deal.added',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'title', type: 'string', description: 'Deal title.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 120 }] },
        { name: 'valueCents', type: 'number', description: 'Deal value in cents.', validations: [{ type: 'min', value: 0 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'business', description: 'Count the new deal.', set: { path: 'pipeline.dealCount', value: 1 } }]
    },
    {
      name: 'Move deal',
      intent: 'Move a deal to another stage.',
      emits: 'crm.deal.moved',
      roles: ['primary'],
      params: [
        { name: 'dealId', type: 'string', description: 'Deal id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] },
        { name: 'stage', type: 'enum', description: 'Target stage.', enumValues: ['lead', 'qualified', 'proposal', 'won', 'lost'], bindTo: 'pipeline.stage' }
      ],
      rules: [{ category: 'business', message: { text: 'Deal moved.', tone: 'info' } }]
    }
  ]
});

const leadCapture = defineBrick({
  id: CRM_IDS.leadCapture,
  name: 'Lead capture',
  category: 'crm',
  surfaceType: 'dialog_area',
  summary: 'Inbound lead form with a consent gate.',
  description:
    'A capture widget for inbound interest. Storing the lead is blocked until the visitor consents, and the email is validated.',
  surfaceName: 'Get a demo',
  surfaceDescription: 'Capture an inbound lead with consent.',
  tags: ['crm', 'lead', 'capture', 'consent'],
  states: [
    { path: 'lead.captured', type: 'boolean', default: false, description: 'Whether the lead was stored.' },
    { path: 'lead.consent', type: 'boolean', default: false, description: 'Whether the visitor consented.' }
  ],
  invariants: [
    { name: 'Captured flag is observable', path: 'lead.captured', op: 'exists', message: 'The captured flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Capture lead',
      intent: 'Store an inbound lead.',
      emits: 'crm.lead.captured',
      roles: ['primary'],
      requiredStates: ['lead.consent'],
      params: [
        { name: 'email', type: 'email', description: 'Lead email.', validations: [{ type: 'non_empty' }, { type: 'email' }] },
        { name: 'name', type: 'string', description: 'Lead name.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 80 }] },
        { name: 'consent', type: 'boolean', description: 'Consent to be contacted.', bindTo: 'lead.consent' }
      ],
      rules: [
        { category: 'compliance', when: { path: 'lead.consent', op: 'is_false' }, block: 'Consent is required to store this lead.' },
        { category: 'business', description: 'Mark the lead captured.', set: { path: 'lead.captured', value: true } }
      ]
    }
  ]
});

export const crmBlueprints: readonly SurfaceBlueprint[] = [contacts, pipeline, leadCapture];
