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

export const storeLocatorBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.map'),
  name: 'Map',
  category: 'utility',
  surfaceType: 'map',
  summary: 'Generic map view with geocoding, place search, and consent-gated geolocation.',
  description:
    'A drop-in geographic surface. Search by address, use the current location (gated on consent), and render points of interest as pins. Suits store locators, branch finders, ride-pickup, delivery zones, real-estate browsers. Anything map-driven.',
  platforms: ['web', 'mobile'],
  tags: ['map', 'geocoding', 'gdpr', 'geolocation', 'places', 'pins'],
  build: ({ ids, ownSurfaceId }) => {
    const geoResourceId = asResourceId('library-utility-res-geocoding');
    const placesResourceId = asResourceId('library-utility-res-places');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Map',
        type: 'map',
        description:
          'Map view with search box, optional geolocation, and a list of nearby pins.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('locator.query'),
            type: 'string',
            defaultValue: ''
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('locator.resultCount'),
            type: 'number',
            defaultValue: 0
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('locator.usingGeolocation'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('consent.geolocation'),
            type: 'boolean',
            defaultValue: false,
            description: 'True once the visitor has granted geolocation permission.'
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'locator.resultCount is non-negative',
            condition: {
              left: asStatePath('locator.resultCount'),
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
            name: 'Search by address',
            intent: 'Geocode the entered address and load nearby stores.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'address',
                type: 'string',
                required: true,
                description: 'Free-text address. Bound to locator.query.',
                resourceId: geoResourceId,
                bindToStatePath: asStatePath('locator.query'),
                validations: [{ type: 'non_empty' }, { type: 'min_length', value: 3 }]
              }
            ],
            requiredStates: [asStatePath('locator.query')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('locator.query'), operator: 'equals', right: '' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Type an address.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('locator.address.searched')
              }
            ],
            emittedEvents: [asEventName('locator.address.searched')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Use my location',
            intent: 'Snap the map to the user current location.',
            parameters: [],
            requiredStates: [
              asStatePath('consent.geolocation'),
              asStatePath('locator.usingGeolocation')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: { left: asStatePath('consent.geolocation'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Grant location permission first.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('locator.usingGeolocation'),
                value: true
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('locator.geolocation.used')
              }
            ],
            emittedEvents: [asEventName('locator.geolocation.used')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'No consent yet',
                description: 'Visitor hasn’t granted geolocation. Compliance rule blocks.',
                stateOverrides: [{ path: asStatePath('consent.geolocation'), value: false }],
                parameterOverrides: []
              },
              {
                id: asScenarioId(ids()),
                name: 'Consent granted',
                description: 'Visitor has consented. Action succeeds.',
                stateOverrides: [{ path: asStatePath('consent.geolocation'), value: true }],
                parameterOverrides: []
              }
            ]
          }
        ]
      },
      resources: [
        {
          id: geoResourceId,
          name: 'Geocoding API',
          description: 'External geocoding service (address → lat/lng).',
          kind: 'http_api',
          provider: 'Mapbox',
          scope: 'external',
          location: 'us-east',
          database: 'https://api.mapbox.com',
          container: '/geocoding/v5',
          field: undefined,
          sensitivity: 'internal',
          containsPii: true,
          complianceTags: ['gdpr'],
          accessMode: 'read',
          authentication: 'api_key',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'managed by provider',
          owner: 'platform-team'
        },
        {
          id: placesResourceId,
          name: 'Places',
          description:
            'Directory of mappable points of interest. Stores, branches, drop-off points, listings, anything pinnable.',
          kind: 'document_db',
          provider: 'MongoDB',
          scope: 'cloud',
          location: 'multi-region',
          database: 'platform',
          container: 'places',
          field: undefined,
          sensitivity: 'public',
          containsPii: false,
          complianceTags: [],
          accessMode: 'read',
          authentication: 'service_account',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: 'indefinite',
          owner: 'platform-team'
        }
      ]
    };
  }
};
