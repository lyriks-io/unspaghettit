import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const MAPS_IDS = {
  explorer: 'library.maps.explorer',
  place: 'library.maps.place',
  directions: 'library.maps.directions'
} as const;

const explorer = defineBrick({
  id: MAPS_IDS.explorer,
  name: 'Map explorer',
  category: 'maps',
  surfaceType: 'map',
  summary: 'Pan/zoom map with pin drops and switchable base layers.',
  description:
    'An interactive map. Zoom is bounded and validated; pins validate latitude and longitude ranges; the base layer is an explicit enum.',
  surfaceName: 'Map',
  surfaceDescription: 'Explore a map, drop pins, and switch base layers.',
  tags: ['maps', 'geo', 'markers', 'zoom'],
  siblings: [{ id: MAPS_IDS.place, label: 'Place details' }],
  states: [
    { path: 'map.zoom', type: 'number', default: 12, description: 'Zoom level (1-20).' },
    { path: 'map.markerCount', type: 'number', default: 0, description: 'Pins on the map.' },
    { path: 'map.layer', type: 'enum', default: 'streets', description: 'Base layer.', enumValues: ['streets', 'satellite', 'terrain'] }
  ],
  invariants: [
    { name: 'Zoom is positive', path: 'map.zoom', op: 'greater_than', value: 0, message: 'Zoom level is always at least 1.' }
  ],
  actions: [
    {
      name: 'Set zoom',
      intent: 'Change the map zoom level.',
      emits: 'map.zoom.changed',
      roles: ['primary'],
      params: [
        { name: 'zoom', type: 'number', description: 'Zoom level.', bindTo: 'map.zoom', validations: [{ type: 'min', value: 1 }, { type: 'max', value: 20 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Zoom changed.', tone: 'info' } }]
    },
    {
      name: 'Drop pin',
      intent: 'Place a marker at a coordinate.',
      emits: 'map.pin.dropped',
      roles: ['primary'],
      params: [
        { name: 'lat', type: 'number', description: 'Latitude.', validations: [{ type: 'min', value: -90 }, { type: 'max', value: 90 }] },
        { name: 'lng', type: 'number', description: 'Longitude.', validations: [{ type: 'min', value: -180 }, { type: 'max', value: 180 }] }
      ],
      rules: [{ category: 'business', description: 'Count the dropped pin.', set: { path: 'map.markerCount', value: 1 } }]
    },
    {
      name: 'Switch layer',
      intent: 'Change the map base layer.',
      emits: 'map.layer.changed',
      roles: ['primary'],
      params: [
        { name: 'layer', type: 'enum', description: 'Base layer.', enumValues: ['streets', 'satellite', 'terrain'], bindTo: 'map.layer' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Layer switched.', tone: 'info' } }]
    }
  ]
});

const place = defineBrick({
  id: MAPS_IDS.place,
  name: 'Place details',
  category: 'maps',
  surfaceType: 'screen',
  summary: 'A place card with save and share.',
  description:
    'The detail panel for a selected place. Saving records a bookmark; sharing copies a link. Both validate the place id.',
  surfaceName: 'Place',
  surfaceDescription: 'Show details for a selected place and let the user save or share it.',
  tags: ['maps', 'place', 'poi', 'save'],
  siblings: [{ id: MAPS_IDS.directions, label: 'Directions' }],
  states: [
    { path: 'place.id', type: 'string', default: '', description: 'Selected place id.' },
    { path: 'place.saved', type: 'boolean', default: false, description: 'Whether the place is bookmarked.' },
    { path: 'place.rating', type: 'number', default: 0, description: 'Average rating out of 5.' }
  ],
  invariants: [
    { name: 'Rating is non-negative', path: 'place.rating', op: 'greater_than', value: -1, message: 'Rating can never be negative.' }
  ],
  actions: [
    {
      name: 'Save place',
      intent: 'Bookmark this place.',
      emits: 'place.saved',
      roles: ['primary'],
      params: [
        { name: 'placeId', type: 'string', description: 'Place id.', bindTo: 'place.id', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'business', description: 'Mark the place saved.', set: { path: 'place.saved', value: true } }]
    },
    {
      name: 'Share place',
      intent: 'Copy a shareable link to this place.',
      emits: 'place.shared',
      roles: ['primary'],
      params: [
        { name: 'placeId', type: 'string', description: 'Place id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Link copied.', tone: 'success' } }]
    }
  ]
});

const directions = defineBrick({
  id: MAPS_IDS.directions,
  name: 'Directions',
  category: 'maps',
  surfaceType: 'map',
  summary: 'Route between two points with a travel-mode selector.',
  description:
    'Turn-by-turn routing. Getting directions validates origin and destination and marks a route present; clearing removes it.',
  surfaceName: 'Directions',
  surfaceDescription: 'Compute a route between an origin and a destination.',
  tags: ['maps', 'directions', 'routing', 'navigation'],
  states: [
    { path: 'directions.mode', type: 'enum', default: 'drive', description: 'Travel mode.', enumValues: ['drive', 'walk', 'transit', 'bike'] },
    { path: 'directions.hasRoute', type: 'boolean', default: false, description: 'Whether a route is computed.' }
  ],
  invariants: [
    { name: 'Route flag is observable', path: 'directions.hasRoute', op: 'exists', message: 'The route flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Get directions',
      intent: 'Compute a route between two points.',
      emits: 'directions.calculated',
      roles: ['primary'],
      params: [
        { name: 'origin', type: 'string', description: 'Start location.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 200 }] },
        { name: 'destination', type: 'string', description: 'End location.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 200 }] },
        { name: 'mode', type: 'enum', description: 'Travel mode.', enumValues: ['drive', 'walk', 'transit', 'bike'], bindTo: 'directions.mode' }
      ],
      rules: [{ category: 'business', description: 'Mark a route as available.', set: { path: 'directions.hasRoute', value: true } }]
    },
    {
      name: 'Clear route',
      intent: 'Remove the current route.',
      emits: 'directions.cleared',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Clear the route flag.', set: { path: 'directions.hasRoute', value: false } }]
    }
  ]
});

export const mapsBlueprints: readonly SurfaceBlueprint[] = [explorer, place, directions];
