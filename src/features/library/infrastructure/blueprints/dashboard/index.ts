import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const DASHBOARD_IDS = {
  analytics: 'library.dashboard.analytics',
  dataTable: 'library.dashboard.data_table',
  activity: 'library.dashboard.activity'
} as const;

const analytics = defineBrick({
  id: DASHBOARD_IDS.analytics,
  name: 'Analytics dashboard',
  category: 'dashboard',
  surfaceType: 'screen',
  summary: 'Metric + date-range selectors with a role-gated report export.',
  description:
    'A KPI dashboard. The date range and headline metric are explicit enums; exporting a report is gated on an admin role.',
  surfaceName: 'Analytics',
  surfaceDescription: 'Inspect key metrics over a selectable date range and export a report.',
  tags: ['dashboard', 'analytics', 'metrics', 'kpi', 'reporting'],
  siblings: [{ id: DASHBOARD_IDS.dataTable, label: 'Data table' }],
  states: [
    { path: 'analytics.range', type: 'enum', default: '7d', description: 'Active date range.', enumValues: ['today', '7d', '30d', '90d'] },
    { path: 'analytics.metric', type: 'enum', default: 'users', description: 'Headline metric.', enumValues: ['users', 'revenue', 'sessions'] },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'A range is always selected', path: 'analytics.range', op: 'exists', message: 'The dashboard must always have a date range.' }
  ],
  actions: [
    {
      name: 'Set range',
      intent: 'Change the reporting date range.',
      emits: 'analytics.range.changed',
      roles: ['primary'],
      params: [
        { name: 'range', type: 'enum', description: 'Date range.', enumValues: ['today', '7d', '30d', '90d'], bindTo: 'analytics.range' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Range updated.', tone: 'info' } }]
    },
    {
      name: 'Set metric',
      intent: 'Change the headline metric.',
      emits: 'analytics.metric.changed',
      roles: ['primary'],
      params: [
        { name: 'metric', type: 'enum', description: 'Metric to chart.', enumValues: ['users', 'revenue', 'sessions'], bindTo: 'analytics.metric' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Metric updated.', tone: 'info' } }]
    },
    {
      name: 'Export report',
      intent: 'Export the current view as a downloadable report.',
      emits: 'analytics.report.exported',
      roles: ['async'],
      requiredStates: ['session.role'],
      params: [
        { name: 'format', type: 'enum', description: 'Export format.', enumValues: ['csv', 'pdf', 'xlsx'] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can export reports.' }
      ]
    }
  ]
});

const dataTable = defineBrick({
  id: DASHBOARD_IDS.dataTable,
  name: 'Data table',
  category: 'dashboard',
  surfaceType: 'screen',
  summary: 'Paginated, sortable table with row selection and a guarded bulk delete.',
  description:
    'A workhorse data grid. Sorting and paging emit events; bulk delete needs a selection and an admin role, so nothing is destroyed by accident.',
  surfaceName: 'Table',
  surfaceDescription: 'Sort, page through, select, and bulk-act on tabular rows.',
  tags: ['dashboard', 'table', 'grid', 'pagination', 'sort'],
  states: [
    { path: 'table.page', type: 'number', default: 1, description: 'Current page (1-based).' },
    { path: 'table.sortDir', type: 'enum', default: 'asc', description: 'Sort direction.', enumValues: ['asc', 'desc'] },
    { path: 'table.selectedCount', type: 'number', default: 0, description: 'Rows currently selected.' },
    { path: 'session.role', type: 'enum', default: 'admin', description: 'Role of the current session.', enumValues: ['owner', 'admin', 'member'] }
  ],
  invariants: [
    { name: 'Page is at least one', path: 'table.page', op: 'greater_than', value: 0, message: 'The current page is always 1 or greater.' }
  ],
  actions: [
    {
      name: 'Sort by column',
      intent: 'Sort the table by a column and direction.',
      emits: 'table.sorted',
      roles: ['primary'],
      params: [
        { name: 'column', type: 'string', description: 'Column key to sort by.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 60 }] },
        { name: 'direction', type: 'enum', description: 'Sort direction.', enumValues: ['asc', 'desc'], bindTo: 'table.sortDir' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Table sorted.', tone: 'info' } }]
    },
    {
      name: 'Go to page',
      intent: 'Jump to a specific page.',
      emits: 'table.page.changed',
      roles: ['primary'],
      params: [
        { name: 'page', type: 'number', description: 'Target page.', bindTo: 'table.page', validations: [{ type: 'min', value: 1 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'business', description: 'Clear the selection when the page changes.', set: { path: 'table.selectedCount', value: 0 } }]
    },
    {
      name: 'Bulk delete',
      intent: 'Delete every selected row.',
      emits: 'table.rows.deleted',
      roles: ['destructive'],
      requiredStates: ['table.selectedCount', 'session.role'],
      rules: [
        { category: 'business', when: { path: 'table.selectedCount', op: 'equals', value: 0 }, block: 'Select at least one row to delete.' },
        { category: 'permissions', when: { path: 'session.role', op: 'equals', value: 'member' }, block: 'Only owners and admins can bulk delete.' }
      ]
    }
  ]
});

const activity = defineBrick({
  id: DASHBOARD_IDS.activity,
  name: 'Activity log',
  category: 'dashboard',
  surfaceType: 'screen',
  summary: 'Chronological activity stream with source filters and refresh.',
  description:
    'A read-mostly stream of recent events. Refresh re-fetches; the filter narrows to your own actions or system events.',
  surfaceName: 'Activity',
  surfaceDescription: 'Review a chronological log of recent activity across the workspace.',
  tags: ['dashboard', 'activity', 'log', 'stream'],
  states: [
    { path: 'activity.count', type: 'number', default: 0, description: 'Entries currently loaded.' },
    { path: 'activity.filter', type: 'enum', default: 'all', description: 'Source filter.', enumValues: ['all', 'mine', 'system'] }
  ],
  invariants: [
    { name: 'Entry count is non-negative', path: 'activity.count', op: 'greater_than', value: -1, message: 'The activity count can never be negative.' }
  ],
  actions: [
    {
      name: 'Refresh',
      intent: 'Re-fetch the latest activity.',
      emits: 'activity.refreshed',
      roles: ['async'],
      rules: [{ category: 'async', message: { text: 'Refreshing activity.', tone: 'info' } }]
    },
    {
      name: 'Set filter',
      intent: 'Filter the activity stream by source.',
      emits: 'activity.filter.changed',
      roles: ['primary'],
      params: [
        { name: 'filter', type: 'enum', description: 'Source filter.', enumValues: ['all', 'mine', 'system'], bindTo: 'activity.filter' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    }
  ]
});

export const dashboardBlueprints: readonly SurfaceBlueprint[] = [analytics, dataTable, activity];
