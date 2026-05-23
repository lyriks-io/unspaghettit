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

export const taskBoardBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.task_board'),
  name: 'Task board',
  category: 'utility',
  surfaceType: 'board',
  summary: 'Kanban-style task board with column moves and limit-aware drops.',
  description:
    'A column-and-card layout. Cards move between columns (todo → doing → done). A WIP limit on the doing column blocks over-loading.',
  platforms: ['web'],
  tags: ['kanban', 'tasks', 'board', 'productivity'],
  build: ({ ids, ownSurfaceId }) => {
    const tasksResourceId = asResourceId('library-utility-res-tasks');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Task board',
        type: 'board',
        description: 'Three-column kanban: Todo / Doing / Done.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('board.activeColumn'),
            type: 'enum',
            enumValues: ['todo', 'doing', 'done'],
            defaultValue: 'todo'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('board.doingCount'),
            type: 'number',
            defaultValue: 0,
            description: 'Number of cards currently in the Doing column.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('board.wipLimit'),
            type: 'number',
            defaultValue: 3,
            description: 'Max cards allowed in Doing.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'doingCount is non-negative',
            condition: {
              left: asStatePath('board.doingCount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Card count must be ≥ 0.'
          }
        ],
        transitions: [],
        actions: [
          {
            id: asActionId(ids()),
            name: 'Move card to column',
            intent: 'Move a task card from its current column to another.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'targetColumn',
                type: 'enum',
                enumValues: ['todo', 'doing', 'done'],
                required: true,
                description: 'Where to drop the card. Bound to board.activeColumn.',
                resourceId: tasksResourceId,
                bindToStatePath: asStatePath('board.activeColumn')
              }
            ],
            requiredStates: [
              asStatePath('board.activeColumn'),
              asStatePath('board.doingCount'),
              asStatePath('board.wipLimit')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in to move cards.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('board.activeColumn'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Pick a target column.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('board.doingCount'),
                  operator: 'greater_than',
                  right: 2
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'WIP limit reached. Finish something before pulling new work.',
                  tone: 'warning'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('board.card.moved')
              }
            ],
            emittedEvents: [asEventName('board.card.moved')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'WIP at limit',
                description: 'Doing column is at its limit. Soft warning fires.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('board.doingCount'), value: 3 }
                ],
                parameterOverrides: [{ parameterName: 'targetColumn', value: 'doing' }]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Authenticated user moves a card to done.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('board.doingCount'), value: 1 }
                ],
                parameterOverrides: [{ parameterName: 'targetColumn', value: 'done' }]
              }
            ]
          }
        ]
      },
      resources: [
        {
          id: tasksResourceId,
          name: 'Tasks (Postgres)',
          description: 'Task records with column, owner, due date.',
          kind: 'relational_db',
          provider: 'PostgreSQL',
          scope: 'cloud',
          location: 'eu-west',
          database: 'project',
          container: 'tasks',
          field: undefined,
          sensitivity: 'internal',
          containsPii: false,
          complianceTags: [],
          accessMode: 'read_write',
          authentication: 'iam_role',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'until project archived',
          owner: 'project-team'
        }
      ]
    };
  }
};
