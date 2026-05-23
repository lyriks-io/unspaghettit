import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

export const searchPaletteBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.search_palette'),
  name: 'Search palette',
  category: 'utility',
  surfaceType: 'command_palette',
  summary: 'Cmd-K style overlay for quick navigation, search, and command execution.',
  description:
    'A command-palette surface. Opens with a global hotkey, accepts a fuzzy query, suggests results, and executes the picked command. Common across modern apps (Slack, Linear, GitHub).',
  platforms: ['web', 'mobile'],
  tags: ['cmd-k', 'palette', 'search', 'shortcut', 'quick-nav'],
  build: ({ ids, ownSurfaceId }) => {
    const indexResourceId = asResourceId('library-utility-res-search-index');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Search palette',
        type: 'command_palette',
        description:
          'Floating overlay launched by Cmd/Ctrl+K. Query routes through a search index.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('palette.open'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('palette.query'),
            type: 'string',
            defaultValue: ''
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('palette.resultCount'),
            type: 'number',
            defaultValue: 0
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'palette.resultCount is non-negative',
            condition: {
              left: asStatePath('palette.resultCount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Result count must be ≥ 0.'
          }
        ],
        transitions: [],
        actions: [
          {
            id: asActionId(ids()),
            name: 'Run query',
            intent: 'Run a fuzzy search and refresh suggestions in the palette.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'query',
                type: 'string',
                required: true,
                description: 'What the user typed. Bound to palette.query.',
                resourceId: indexResourceId,
                bindToStatePath: asStatePath('palette.query'),
                validations: [{ type: 'max_length', value: 200 }]
              }
            ],
            requiredStates: [asStatePath('palette.query'), asStatePath('palette.open')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('palette.query'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'Type at least one character.',
                  tone: 'info'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('palette.query.executed')
              }
            ],
            emittedEvents: [asEventName('palette.query.executed')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Empty query',
                description: 'User submits a blank query. Soft hint fires.',
                stateOverrides: [{ path: asStatePath('palette.open'), value: true }],
                parameterOverrides: [{ parameterName: 'query', value: '' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Specific keyword',
                description: 'A focused query that should produce results.',
                stateOverrides: [
                  { path: asStatePath('palette.open'), value: true },
                  { path: asStatePath('palette.resultCount'), value: 8 }
                ],
                parameterOverrides: [{ parameterName: 'query', value: 'invoice' }]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Close palette',
            intent: 'Dismiss the palette overlay.',
            parameters: [],
            requiredStates: [asStatePath('palette.open')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('palette.open'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Palette is already closed.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('palette.open'),
                value: false
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('palette.closed')
              }
            ],
            emittedEvents: [asEventName('palette.closed')],
            transitions: []
          }
        ]
      },
      resources: [
        {
          id: indexResourceId,
          name: 'Global search index (OpenSearch)',
          description: 'Cross-feature search index used by the command palette.',
          kind: 'document_db',
          provider: 'OpenSearch',
          scope: 'cloud',
          location: 'eu-west',
          database: 'global-search',
          container: 'documents',
          field: undefined,
          sensitivity: 'internal',
          containsPii: false,
          complianceTags: [],
          accessMode: 'read',
          authentication: 'service_account',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'rebuilt nightly',
          owner: 'platform-team'
        }
      ]
    };
  }
};
