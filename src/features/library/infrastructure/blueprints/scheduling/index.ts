import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const SCHEDULING_IDS = {
  calendar: 'library.scheduling.calendar',
  booking: 'library.scheduling.booking',
  availability: 'library.scheduling.availability'
} as const;

const calendar = defineBrick({
  id: SCHEDULING_IDS.calendar,
  name: 'Calendar',
  category: 'scheduling',
  surfaceType: 'screen',
  summary: 'Day / week / month calendar with event creation and validation.',
  description:
    'A calendar surface. Creating an event validates the title, start timestamp, and a positive duration; switching views is a pure preference change.',
  surfaceName: 'Calendar',
  surfaceDescription: 'View events across day, week, and month, and create new events.',
  tags: ['scheduling', 'calendar', 'events'],
  siblings: [{ id: SCHEDULING_IDS.booking, label: 'Book a slot' }],
  states: [
    { path: 'calendar.view', type: 'enum', default: 'week', description: 'Active calendar view.', enumValues: ['day', 'week', 'month'] },
    { path: 'calendar.eventCount', type: 'number', default: 0, description: 'Events in the visible range.' }
  ],
  invariants: [
    { name: 'Event count is non-negative', path: 'calendar.eventCount', op: 'greater_than', value: -1, message: 'The event count can never be negative.' }
  ],
  actions: [
    {
      name: 'Create event',
      intent: 'Add a new event to the calendar.',
      emits: 'calendar.event.created',
      roles: ['primary', 'persistence'],
      params: [
        { name: 'title', type: 'string', description: 'Event title.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 120 }] },
        { name: 'startsAt', type: 'timestamp', description: 'Event start.', validations: [{ type: 'non_empty' }, { type: 'iso_datetime' }] },
        { name: 'durationMinutes', type: 'number', description: 'Length in minutes.', validations: [{ type: 'min', value: 5 }, { type: 'integer' }] }
      ],
      rules: [{ category: 'business', description: 'Count the newly created event.', set: { path: 'calendar.eventCount', value: 1 } }]
    },
    {
      name: 'Change view',
      intent: 'Switch between day, week, and month.',
      emits: 'calendar.view.changed',
      roles: ['primary'],
      params: [
        { name: 'view', type: 'enum', description: 'Calendar view.', enumValues: ['day', 'week', 'month'], bindTo: 'calendar.view' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'View changed.', tone: 'info' } }]
    }
  ]
});

const booking = defineBrick({
  id: SCHEDULING_IDS.booking,
  name: 'Appointment booking',
  category: 'scheduling',
  surfaceType: 'screen',
  summary: 'Pick a slot then confirm with contact details, slot-first gated.',
  description:
    'A two-step booking flow. A slot must be selected before confirmation, and confirmation validates the guest name and email.',
  surfaceName: 'Book',
  surfaceDescription: 'Select an available time slot and confirm the appointment.',
  tags: ['scheduling', 'booking', 'appointment'],
  siblings: [{ id: SCHEDULING_IDS.availability, label: 'Availability' }],
  states: [
    { path: 'booking.slotId', type: 'string', default: '', description: 'Selected slot id.' },
    { path: 'booking.slotSelected', type: 'boolean', default: false, description: 'Whether a slot is chosen.' },
    { path: 'booking.confirmed', type: 'boolean', default: false, description: 'Whether the booking is confirmed.' }
  ],
  invariants: [
    { name: 'Confirmation flag is observable', path: 'booking.confirmed', op: 'exists', message: 'The confirmation flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Select slot',
      intent: 'Choose an available time slot.',
      emits: 'booking.slot.selected',
      roles: ['entry'],
      params: [
        { name: 'slotId', type: 'string', description: 'Slot id.', bindTo: 'booking.slotId', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'business', description: 'Mark a slot as selected.', set: { path: 'booking.slotSelected', value: true } }]
    },
    {
      name: 'Confirm booking',
      intent: 'Confirm the appointment with contact details.',
      emits: 'booking.confirmed',
      roles: ['primary'],
      requiredStates: ['booking.slotSelected'],
      params: [
        { name: 'name', type: 'string', description: 'Guest name.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 80 }] },
        { name: 'email', type: 'email', description: 'Guest email.', validations: [{ type: 'non_empty' }, { type: 'email' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'booking.slotSelected', op: 'is_false' }, block: 'Pick a time slot before confirming.' },
        { category: 'business', description: 'Mark the booking confirmed.', set: { path: 'booking.confirmed', value: true } }
      ]
    }
  ]
});

const availability = defineBrick({
  id: SCHEDULING_IDS.availability,
  name: 'Availability',
  category: 'scheduling',
  surfaceType: 'screen',
  summary: 'Toggle bookability and define weekly slots with time validation.',
  description:
    'The host side of scheduling. A master toggle opens or closes bookings; each added slot validates a weekday and ISO start/end times.',
  surfaceName: 'Availability',
  surfaceDescription: 'Define when the account accepts bookings.',
  tags: ['scheduling', 'availability', 'slots', 'hours'],
  states: [
    { path: 'availability.acceptingBookings', type: 'boolean', default: true, description: 'Whether new bookings are accepted.' },
    { path: 'availability.slotCount', type: 'number', default: 0, description: 'Number of weekly slots defined.' }
  ],
  invariants: [
    { name: 'Slot count is non-negative', path: 'availability.slotCount', op: 'greater_than', value: -1, message: 'Slot count can never be negative.' }
  ],
  actions: [
    {
      name: 'Toggle bookings',
      intent: 'Open or close the calendar to new bookings.',
      emits: 'availability.toggled',
      roles: ['primary'],
      params: [
        { name: 'accepting', type: 'boolean', description: 'Whether to accept bookings.', bindTo: 'availability.acceptingBookings' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Availability updated.', tone: 'success' } }]
    },
    {
      name: 'Add slot',
      intent: 'Add a recurring weekly availability slot.',
      emits: 'availability.slot.added',
      roles: ['primary'],
      params: [
        { name: 'day', type: 'enum', description: 'Weekday.', enumValues: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
        { name: 'start', type: 'time', description: 'Start time.', validations: [{ type: 'non_empty' }, { type: 'iso_time' }] },
        { name: 'end', type: 'time', description: 'End time.', validations: [{ type: 'non_empty' }, { type: 'iso_time' }] }
      ],
      rules: [{ category: 'business', description: 'Count the new slot.', set: { path: 'availability.slotCount', value: 1 } }]
    }
  ]
});

export const schedulingBlueprints: readonly SurfaceBlueprint[] = [calendar, booking, availability];
