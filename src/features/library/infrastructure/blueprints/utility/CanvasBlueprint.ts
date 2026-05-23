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

export const canvasBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.canvas'),
  name: 'Canvas',
  category: 'utility',
  surfaceType: 'canvas',
  summary: 'Free-form Figma/Miro-style canvas with shape add, move, and selection.',
  description:
    'A blank infinite canvas. Authenticated users add shapes/text/images, select and move them, and save snapshots. Element-count cap and viewer-vs-editor permission gating.',
  platforms: ['web'],
  tags: ['canvas', 'whiteboard', 'figma', 'miro', 'collaboration'],
  build: ({ ids, ownSurfaceId }) => {
    const canvasResourceId = asResourceId('library-utility-res-canvas-doc');
    const assetsResourceId = asResourceId('library-utility-res-canvas-assets');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Canvas',
        type: 'canvas',
        description:
          'Free-form drawing surface. Each element has a position; selection state drives the right-side properties panel.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('canvas.elementCount'),
            type: 'number',
            defaultValue: 0,
            description: 'Total elements currently on the canvas.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('canvas.maxElements'),
            type: 'number',
            defaultValue: 500,
            description: 'Plan limit. Writes are blocked once elementCount reaches this.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('canvas.selectedId'),
            type: 'string',
            defaultValue: '',
            description: 'ID of the currently focused element. Bound from selection actions.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('canvas.role'),
            type: 'enum',
            enumValues: ['editor', 'viewer'],
            defaultValue: 'viewer',
            description: 'Per-canvas access role for the active user.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [
          {
            id: asRuleId(ids()),
            category: 'permissions',
            condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
            effect: {
              id: asEffectId(ids()),
              type: 'show_message',
              message: 'You are viewing a shared canvas. Sign in to edit.',
              tone: 'info'
            },
            description:
              'Surface-level guard: anonymous visitors can view but each action gates writes.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'elementCount is non-negative',
            condition: {
              left: asStatePath('canvas.elementCount'),
              operator: 'greater_than',
              right: -1
            },
            message: 'Element count must be ≥ 0.'
          }
        ],
        transitions: [],
        actions: [
          {
            id: asActionId(ids()),
            name: 'Add element',
            intent: 'Drop a new shape, text, or image on the canvas at a chosen position.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'kind',
                type: 'enum',
                enumValues: ['rectangle', 'ellipse', 'line', 'text', 'image', 'sticky_note'],
                required: true,
                description: 'What to add. Bound nowhere. Just drives the new element type.',
                resourceId: canvasResourceId
              },
              {
                id: asParameterId(ids()),
                name: 'position',
                type: 'string',
                required: true,
                description: 'Stringified `{x, y}` of the drop point.',
                resourceId: canvasResourceId,
                validations: [{ type: 'non_empty' }]
              }
            ],
            requiredStates: [
              asStatePath('canvas.elementCount'),
              asStatePath('canvas.maxElements'),
              asStatePath('canvas.role')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: {
                  left: asStatePath('canvas.role'),
                  operator: 'not_equals',
                  right: 'editor'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'You need editor access to add elements.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('canvas.elementCount'),
                  operator: 'greater_than',
                  right: 499
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Element limit reached for this plan.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('canvas.role'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Canvas role missing. Refresh.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('canvas.elementCount'),
                value: 1
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('canvas.element.added')
              }
            ],
            emittedEvents: [asEventName('canvas.element.added')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Viewer tries to add',
                description: 'Viewer role. Permissions rule blocks.',
                stateOverrides: [
                  { path: asStatePath('canvas.role'), value: 'viewer' },
                  { path: asStatePath('canvas.elementCount'), value: 12 }
                ],
                parameterOverrides: [
                  { parameterName: 'kind', value: 'rectangle' },
                  { parameterName: 'position', value: '{"x":120,"y":80}' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'At plan limit',
                description: 'elementCount reached the cap. Business rule blocks.',
                stateOverrides: [
                  { path: asStatePath('canvas.role'), value: 'editor' },
                  { path: asStatePath('canvas.elementCount'), value: 500 }
                ],
                parameterOverrides: [
                  { parameterName: 'kind', value: 'sticky_note' },
                  { parameterName: 'position', value: '{"x":40,"y":40}' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Editor with room to add. Action succeeds.',
                stateOverrides: [
                  { path: asStatePath('canvas.role'), value: 'editor' },
                  { path: asStatePath('canvas.elementCount'), value: 12 }
                ],
                parameterOverrides: [
                  { parameterName: 'kind', value: 'sticky_note' },
                  { parameterName: 'position', value: '{"x":200,"y":150}' }
                ]
              }
            ]
          },
          {
            id: asActionId(ids()),
            name: 'Select element',
            intent: 'Focus a single element so the properties panel can edit it.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'elementId',
                type: 'string',
                required: true,
                description: 'ID to select. Bound to canvas.selectedId.',
                resourceId: canvasResourceId,
                bindToStatePath: asStatePath('canvas.selectedId'),
                validations: [{ type: 'non_empty' }]
              }
            ],
            requiredStates: [asStatePath('canvas.selectedId')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('canvas.selectedId'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'No element id provided.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('canvas.element.selected')
              }
            ],
            emittedEvents: [asEventName('canvas.element.selected')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Delete selection',
            intent: 'Remove the currently selected element.',
            parameters: [],
            requiredStates: [asStatePath('canvas.selectedId'), asStatePath('canvas.role')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: {
                  left: asStatePath('canvas.role'),
                  operator: 'not_equals',
                  right: 'editor'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Editor access required to delete.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('canvas.selectedId'),
                  operator: 'equals',
                  right: ''
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Select an element first.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('canvas.selectedId'),
                value: ''
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('canvas.element.deleted')
              }
            ],
            emittedEvents: [asEventName('canvas.element.deleted')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Save canvas',
            intent: 'Persist the canvas snapshot to storage.',
            parameters: [],
            requiredStates: [asStatePath('canvas.role'), asStatePath('user.authenticated')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in to save your canvas.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: {
                  left: asStatePath('canvas.role'),
                  operator: 'not_equals',
                  right: 'editor'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Editor access required.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('canvas.saved')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Canvas saved.',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('canvas.saved')],
            transitions: []
          }
        ]
      },
      resources: [
        {
          id: canvasResourceId,
          name: 'Canvas documents (Postgres)',
          description: 'Per-canvas document with elements, layers, and metadata.',
          kind: 'relational_db',
          provider: 'PostgreSQL',
          scope: 'cloud',
          location: 'eu-west',
          database: 'project',
          container: 'canvas_documents',
          field: undefined,
          sensitivity: 'internal',
          containsPii: false,
          complianceTags: [],
          accessMode: 'read_write',
          authentication: 'iam_role',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'until canvas deleted',
          owner: 'project-team'
        },
        {
          id: assetsResourceId,
          name: 'Canvas assets (S3)',
          description: 'Uploaded images and binary assets referenced by canvas elements.',
          kind: 'object_storage',
          provider: 'AWS S3',
          scope: 'cloud',
          location: 'eu-west',
          database: 'project-assets',
          container: 'canvas/',
          field: undefined,
          sensitivity: 'internal',
          containsPii: false,
          complianceTags: [],
          accessMode: 'read_write',
          authentication: 'iam_role',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: '90 days after canvas deleted',
          owner: 'project-team'
        }
      ]
    };
  }
};
