import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const SEARCH_IDS = {
  results: 'library.search.results',
  filters: 'library.search.filters',
  autocomplete: 'library.search.autocomplete'
} as const;

const results = defineBrick({
  id: SEARCH_IDS.results,
  name: 'Search results',
  category: 'search',
  surfaceType: 'screen',
  summary: 'Results list with a query, sort, and an in-flight guard.',
  description:
    'The results page. Running a search is blocked while one is already loading; sort is an explicit enum that emits an event.',
  surfaceName: 'Results',
  surfaceDescription: 'Run a query and browse ranked results.',
  tags: ['search', 'results', 'sort', 'query'],
  siblings: [{ id: SEARCH_IDS.filters, label: 'Filters' }],
  states: [
    { path: 'search.query', type: 'string', default: '', description: 'Active query text.' },
    { path: 'search.resultCount', type: 'number', default: 0, description: 'Matching results.' },
    { path: 'search.sort', type: 'enum', default: 'relevance', description: 'Sort order.', enumValues: ['relevance', 'newest', 'price'] },
    { path: 'search.loading', type: 'boolean', default: false, description: 'True while a search runs.' }
  ],
  invariants: [
    { name: 'Result count is non-negative', path: 'search.resultCount', op: 'greater_than', value: -1, message: 'Result count can never be negative.' }
  ],
  actions: [
    {
      name: 'Run search',
      intent: 'Execute a search query.',
      emits: 'search.executed',
      roles: ['primary', 'async'],
      requiredStates: ['search.loading'],
      params: [
        { name: 'query', type: 'string', description: 'Search text.', bindTo: 'search.query', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 200 }] }
      ],
      rules: [
        { category: 'async', when: { path: 'search.loading', op: 'is_true' }, block: 'A search is already running.' }
      ]
    },
    {
      name: 'Sort results',
      intent: 'Change the result ordering.',
      emits: 'search.sorted',
      roles: ['primary'],
      params: [
        { name: 'sort', type: 'enum', description: 'Sort order.', enumValues: ['relevance', 'newest', 'price'], bindTo: 'search.sort' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Results reordered.', tone: 'info' } }]
    }
  ]
});

const filters = defineBrick({
  id: SEARCH_IDS.filters,
  name: 'Faceted filters',
  category: 'search',
  surfaceType: 'dialog_area',
  summary: 'Facet chips with an apply and clear-all, counting active facets.',
  description:
    'The refinement panel next to a result list. Applying a facet bumps the active count; clear-all resets everything at once.',
  surfaceName: 'Filters',
  surfaceDescription: 'Narrow results by category, brand, price, and more.',
  tags: ['search', 'filters', 'facets', 'refine'],
  states: [
    { path: 'facets.activeCount', type: 'number', default: 0, description: 'Number of active facets.' },
    { path: 'facets.inStockOnly', type: 'boolean', default: false, description: 'Whether to hide out-of-stock items.' }
  ],
  invariants: [
    { name: 'Active facet count is non-negative', path: 'facets.activeCount', op: 'greater_than', value: -1, message: 'Active facet count can never be negative.' }
  ],
  actions: [
    {
      name: 'Apply facet',
      intent: 'Add a facet to the active filter set.',
      emits: 'facets.applied',
      roles: ['primary'],
      params: [
        { name: 'facet', type: 'enum', description: 'Facet dimension.', enumValues: ['category', 'brand', 'color', 'size'] },
        { name: 'value', type: 'string', description: 'Facet value.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 60 }] }
      ],
      rules: [{ category: 'business', description: 'Count the applied facet.', set: { path: 'facets.activeCount', value: 1 } }]
    },
    {
      name: 'Clear all',
      intent: 'Remove every active facet.',
      emits: 'facets.cleared',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Reset the active count.', set: { path: 'facets.activeCount', value: 0 } }]
    }
  ]
});

const autocomplete = defineBrick({
  id: SEARCH_IDS.autocomplete,
  name: 'Autocomplete',
  category: 'search',
  surfaceType: 'command_palette',
  summary: 'Typeahead suggestions with keyboard selection.',
  description:
    'A command-palette style typeahead. Typing fetches suggestions; selecting is blocked when the suggestion list is empty.',
  surfaceName: 'Quick find',
  surfaceDescription: 'Suggest matches as the user types.',
  tags: ['search', 'autocomplete', 'typeahead', 'command-palette'],
  states: [
    { path: 'typeahead.query', type: 'string', default: '', description: 'Current typed text.' },
    { path: 'typeahead.suggestionCount', type: 'number', default: 0, description: 'Suggestions shown.' },
    { path: 'typeahead.highlightedIndex', type: 'number', default: 0, description: 'Keyboard-highlighted row.' }
  ],
  invariants: [
    { name: 'Suggestion count is non-negative', path: 'typeahead.suggestionCount', op: 'greater_than', value: -1, message: 'Suggestion count can never be negative.' }
  ],
  actions: [
    {
      name: 'Type query',
      intent: 'Update the typeahead query.',
      emits: 'typeahead.queried',
      roles: ['primary'],
      params: [
        { name: 'query', type: 'string', description: 'Typed text.', required: false, defaultValue: '', bindTo: 'typeahead.query', validations: [{ type: 'max_length', value: 100 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Fetching suggestions.', tone: 'info' } }]
    },
    {
      name: 'Select suggestion',
      intent: 'Choose a highlighted suggestion.',
      emits: 'typeahead.selected',
      roles: ['primary'],
      requiredStates: ['typeahead.suggestionCount'],
      params: [
        { name: 'index', type: 'number', description: 'Suggestion index.', validations: [{ type: 'min', value: 0 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'typeahead.suggestionCount', op: 'equals', value: 0 }, block: 'There are no suggestions to choose.' }
      ]
    }
  ]
});

export const searchBlueprints: readonly SurfaceBlueprint[] = [results, filters, autocomplete];
