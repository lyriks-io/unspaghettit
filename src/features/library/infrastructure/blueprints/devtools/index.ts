import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const DEVTOOLS_IDS = {
  apiPlayground: 'library.devtools.api_playground',
  webhooks: 'library.devtools.webhooks',
  logs: 'library.devtools.logs'
} as const;

const apiPlayground = defineBrick({
  id: DEVTOOLS_IDS.apiPlayground,
  name: 'API playground',
  category: 'devtools',
  surfaceType: 'api_playground',
  summary: 'Compose and send HTTP requests with an in-flight guard.',
  description:
    'An interactive request console. Sending is blocked while a request is in flight; requests can be saved to a collection.',
  surfaceName: 'API console',
  surfaceDescription: 'Build and send API requests and inspect responses.',
  tags: ['devtools', 'api', 'http', 'playground'],
  siblings: [{ id: DEVTOOLS_IDS.webhooks, label: 'Webhooks' }],
  states: [
    { path: 'api.method', type: 'enum', default: 'GET', description: 'HTTP method.', enumValues: ['GET', 'POST', 'PUT', 'DELETE'] },
    { path: 'api.lastStatus', type: 'number', default: 0, description: 'Last response status code.' },
    { path: 'api.sending', type: 'boolean', default: false, description: 'True while a request is in flight.' }
  ],
  invariants: [
    { name: 'Status code is non-negative', path: 'api.lastStatus', op: 'greater_than', value: -1, message: 'The status code can never be negative.' }
  ],
  actions: [
    {
      name: 'Send request',
      intent: 'Send the composed HTTP request.',
      emits: 'api.request.sent',
      roles: ['async'],
      requiredStates: ['api.sending'],
      params: [
        { name: 'url', type: 'url', description: 'Request URL.', validations: [{ type: 'non_empty' }, { type: 'url' }] },
        { name: 'method', type: 'enum', description: 'HTTP method.', enumValues: ['GET', 'POST', 'PUT', 'DELETE'], bindTo: 'api.method' },
        { name: 'body', type: 'string', description: 'Request body.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 100000 }] }
      ],
      rules: [
        { category: 'async', when: { path: 'api.sending', op: 'is_true' }, block: 'A request is already in flight.' }
      ]
    },
    {
      name: 'Save as example',
      intent: 'Save the request to a collection.',
      emits: 'api.example.saved',
      roles: ['persistence'],
      params: [
        { name: 'name', type: 'string', description: 'Example name.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 60 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Saved to collection.', tone: 'success' } }]
    }
  ]
});

const webhooks = defineBrick({
  id: DEVTOOLS_IDS.webhooks,
  name: 'Webhooks',
  category: 'devtools',
  surfaceType: 'screen',
  summary: 'Register and disable webhook endpoints behind an admin gate.',
  description:
    'A webhook manager. Adding validates the endpoint URL and event; both mutations are gated on an admin role.',
  surfaceName: 'Webhooks',
  surfaceDescription: 'Manage outbound webhook endpoints.',
  tags: ['devtools', 'webhooks', 'endpoints', 'events'],
  states: [
    { path: 'webhooks.count', type: 'number', default: 0, description: 'Configured endpoints.' },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'Endpoint count is non-negative', path: 'webhooks.count', op: 'greater_than', value: -1, message: 'Endpoint count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add endpoint',
      intent: 'Register a new webhook endpoint.',
      emits: 'webhook.endpoint.added',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'url', type: 'url', description: 'Endpoint URL.', validations: [{ type: 'non_empty' }, { type: 'url' }] },
        { name: 'event', type: 'enum', description: 'Event to deliver.', enumValues: ['created', 'updated', 'deleted'] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can add endpoints.' }
      ]
    },
    {
      name: 'Disable endpoint',
      intent: 'Disable a webhook endpoint.',
      emits: 'webhook.endpoint.disabled',
      roles: ['primary'],
      requiredStates: ['session.role'],
      params: [
        { name: 'endpointId', type: 'string', description: 'Endpoint id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can disable endpoints.' }
      ]
    }
  ]
});

const logs = defineBrick({
  id: DEVTOOLS_IDS.logs,
  name: 'Logs viewer',
  category: 'devtools',
  surfaceType: 'terminal',
  summary: 'Streaming log console with level filter and follow toggle.',
  description:
    'A tailing log view. The level filter narrows severity; follow toggles auto-scroll as new lines arrive.',
  surfaceName: 'Logs',
  surfaceDescription: 'Stream and filter application logs.',
  tags: ['devtools', 'logs', 'observability', 'terminal'],
  states: [
    { path: 'logs.lineCount', type: 'number', default: 0, description: 'Lines currently buffered.' },
    { path: 'logs.level', type: 'enum', default: 'info', description: 'Minimum level shown.', enumValues: ['debug', 'info', 'warn', 'error'] },
    { path: 'logs.following', type: 'boolean', default: true, description: 'Whether the view auto-scrolls.' }
  ],
  invariants: [
    { name: 'Line count is non-negative', path: 'logs.lineCount', op: 'greater_than', value: -1, message: 'Line count can never be negative.' }
  ],
  actions: [
    {
      name: 'Set level',
      intent: 'Change the minimum log level shown.',
      emits: 'logs.level.changed',
      roles: ['primary'],
      params: [
        { name: 'level', type: 'enum', description: 'Minimum level.', enumValues: ['debug', 'info', 'warn', 'error'], bindTo: 'logs.level' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Log level changed.', tone: 'info' } }]
    },
    {
      name: 'Toggle follow',
      intent: 'Turn auto-scroll on or off.',
      emits: 'logs.follow.toggled',
      roles: ['primary'],
      params: [
        { name: 'follow', type: 'boolean', description: 'Whether to follow.', bindTo: 'logs.following' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Follow toggled.', tone: 'info' } }]
    }
  ]
});

export const devtoolsBlueprints: readonly SurfaceBlueprint[] = [apiPlayground, webhooks, logs];
