import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const HR_IDS = {
  directory: 'library.hr.directory',
  timeOff: 'library.hr.time_off'
} as const;

const directory = defineBrick({
  id: HR_IDS.directory,
  name: 'Employee directory',
  category: 'hr',
  surfaceType: 'screen',
  summary: 'Searchable people directory with department filtering.',
  description:
    'A company directory. Search accepts an optional query; the department filter narrows the list. Both are read-only browsing actions.',
  surfaceName: 'Directory',
  surfaceDescription: 'Find people across the organisation.',
  tags: ['hr', 'directory', 'employees', 'people'],
  siblings: [{ id: HR_IDS.timeOff, label: 'Time off' }],
  states: [
    { path: 'directory.count', type: 'number', default: 0, description: 'People in view.' },
    { path: 'directory.department', type: 'enum', default: 'engineering', description: 'Active department filter.', enumValues: ['engineering', 'sales', 'marketing', 'hr', 'ops'] }
  ],
  invariants: [
    { name: 'Directory count is non-negative', path: 'directory.count', op: 'greater_than', value: -1, message: 'Directory count can never be negative.' }
  ],
  actions: [
    {
      name: 'Search employees',
      intent: 'Search the directory.',
      emits: 'hr.directory.searched',
      roles: ['primary'],
      params: [
        { name: 'query', type: 'string', description: 'Search text.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 120 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Searching directory.', tone: 'info' } }]
    },
    {
      name: 'Filter department',
      intent: 'Filter people by department.',
      emits: 'hr.department.filtered',
      roles: ['primary'],
      params: [
        { name: 'department', type: 'enum', description: 'Department.', enumValues: ['engineering', 'sales', 'marketing', 'hr', 'ops'], bindTo: 'directory.department' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    }
  ]
});

const timeOff = defineBrick({
  id: HR_IDS.timeOff,
  name: 'Time off request',
  category: 'hr',
  surfaceType: 'workflow',
  summary: 'Request PTO with a balance guard and cancel.',
  description:
    'A leave request flow. Requesting is blocked when the balance is zero and validates the date range; a pending request can be cancelled.',
  surfaceName: 'Time off',
  surfaceDescription: 'Request and cancel paid time off.',
  tags: ['hr', 'pto', 'leave', 'time-off'],
  states: [
    { path: 'timeOff.balanceDays', type: 'number', default: 20, description: 'Remaining leave days.' },
    { path: 'timeOff.pendingDays', type: 'number', default: 0, description: 'Days awaiting approval.' },
    { path: 'timeOff.submitted', type: 'boolean', default: false, description: 'Whether a request is pending.' }
  ],
  invariants: [
    { name: 'Balance is non-negative', path: 'timeOff.balanceDays', op: 'greater_than', value: -1, message: 'Leave balance can never be negative.' }
  ],
  actions: [
    {
      name: 'Request time off',
      intent: 'Submit a leave request.',
      emits: 'hr.timeoff.requested',
      roles: ['primary'],
      requiredStates: ['timeOff.balanceDays'],
      params: [
        { name: 'startDate', type: 'date', description: 'First day off.', validations: [{ type: 'non_empty' }, { type: 'iso_date' }] },
        { name: 'endDate', type: 'date', description: 'Last day off.', validations: [{ type: 'non_empty' }, { type: 'iso_date' }] },
        { name: 'type', type: 'enum', description: 'Leave type.', enumValues: ['vacation', 'sick', 'personal'] }
      ],
      rules: [
        { category: 'business', when: { path: 'timeOff.balanceDays', op: 'equals', value: 0 }, block: 'You have no remaining leave balance.' },
        { category: 'business', description: 'Mark a request as pending.', set: { path: 'timeOff.submitted', value: true } }
      ]
    },
    {
      name: 'Cancel request',
      intent: 'Withdraw a pending request.',
      emits: 'hr.timeoff.cancelled',
      roles: ['primary'],
      requiredStates: ['timeOff.submitted'],
      rules: [
        { category: 'business', when: { path: 'timeOff.submitted', op: 'is_false' }, block: 'There is no request to cancel.' },
        { category: 'business', description: 'Clear the pending request.', set: { path: 'timeOff.submitted', value: false } }
      ]
    }
  ]
});

export const hrBlueprints: readonly SurfaceBlueprint[] = [directory, timeOff];
