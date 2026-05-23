import {
  asActionId,
  asEffectId,
  asInvariantId,
  asRuleId,
  asStateDefinitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

export const notFoundBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.not_found'),
  name: '404. Not found',
  category: 'utility',
  surfaceType: 'screen',
  summary: 'A friendly not-found page that emits a missing-resource event for telemetry.',
  description:
    'Drop-in catch-all surface for unknown routes. Emits page.not_found with the requested path so analytics can spot dead links.',
  platforms: ['web', 'mobile'],
  tags: ['404', 'not-found', 'error', 'telemetry'],
  build: ({ ids, ownSurfaceId }) => ({
    surface: {
      id: ownSurfaceId,
      name: '404',
      type: 'screen',
      description: 'Shown when the user lands on a path the feature does not recognise.',
      stateDefinitions: [
        {
          id: asStateDefinitionId(ids()),
          path: asStatePath('error.requestedPath'),
          type: 'string',
          defaultValue: '',
          description: 'The path the user tried to reach. Recorded for telemetry.'
        }
      ],
      rules: [],
      invariants: [
        {
          id: asInvariantId(ids()),
          name: 'requestedPath is observable',
          condition: { left: asStatePath('error.requestedPath'), operator: 'exists' },
          message: 'The 404 surface should always know which path was missed.'
        }
      ],
      transitions: [],
      actions: [
        {
          id: asActionId(ids()),
          name: 'Report missing route',
          intent: 'Emit a telemetry event for the missed path.',
          parameters: [],
          requiredStates: [asStatePath('error.requestedPath')],
          rules: [
            {
              id: asRuleId(ids()),
              category: 'audit',
              condition: {
                left: asStatePath('error.requestedPath'),
                operator: 'equals',
                right: ''
              },
              effect: {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'No path captured. Telemetry will be skipped.',
                tone: 'warning'
              }
            }
          ],
          invariants: [],
          effects: [
            {
              id: asEffectId(ids()),
              type: 'emit_event',
              event: asEventName('page.not_found')
            }
          ],
          emittedEvents: [asEventName('page.not_found')],
          transitions: []
        }
      ]
    }
  })
};
