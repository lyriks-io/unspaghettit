import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const PRODUCTIVITY_IDS = {
  kanban: 'library.productivity.kanban',
  notes: 'library.productivity.notes',
  timeTracker: 'library.productivity.time_tracker'
} as const;

const kanban = defineBrick({
  id: PRODUCTIVITY_IDS.kanban,
  name: 'Kanban board',
  category: 'productivity',
  surfaceType: 'board',
  summary: 'Columns of cards with add and move across statuses.',
  description:
    'A task board. Adding a card validates the title and counts it; moving a card changes its column.',
  surfaceName: 'Board',
  surfaceDescription: 'Organise work as cards moving across columns.',
  tags: ['productivity', 'kanban', 'board', 'tasks'],
  siblings: [{ id: PRODUCTIVITY_IDS.notes, label: 'Notes' }],
  states: [
    { path: 'kanban.cardCount', type: 'number', default: 0, description: 'Cards on the board.' },
    { path: 'kanban.wipLimit', type: 'number', default: 5, description: 'Work-in-progress limit per column.' },
    { path: 'kanban.column', type: 'enum', default: 'todo', description: 'Selected column.', enumValues: ['todo', 'doing', 'done'] }
  ],
  invariants: [
    { name: 'Card count is non-negative', path: 'kanban.cardCount', op: 'greater_than', value: -1, message: 'Card count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add card',
      intent: 'Create a new card in the To do column.',
      emits: 'kanban.card.added',
      roles: ['primary'],
      params: [
        { name: 'title', type: 'string', description: 'Card title.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 120 }] }
      ],
      rules: [{ category: 'business', description: 'Count the new card.', set: { path: 'kanban.cardCount', value: 1 } }]
    },
    {
      name: 'Move card',
      intent: 'Move a card to another column.',
      emits: 'kanban.card.moved',
      roles: ['primary'],
      params: [
        { name: 'cardId', type: 'string', description: 'Card id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] },
        { name: 'column', type: 'enum', description: 'Target column.', enumValues: ['todo', 'doing', 'done'], bindTo: 'kanban.column' }
      ],
      rules: [{ category: 'business', message: { text: 'Card moved.', tone: 'info' } }]
    }
  ]
});

const notes = defineBrick({
  id: PRODUCTIVITY_IDS.notes,
  name: 'Notes editor',
  category: 'productivity',
  surfaceType: 'screen',
  summary: 'Document editor with save and permissioned sharing.',
  description:
    'A doc surface. Saving persists the body; sharing sets a permission level and records that the doc is shared.',
  surfaceName: 'Doc',
  surfaceDescription: 'Write and share a document.',
  tags: ['productivity', 'notes', 'docs', 'editor'],
  states: [
    { path: 'doc.wordCount', type: 'number', default: 0, description: 'Length in words.' },
    { path: 'doc.saved', type: 'boolean', default: false, description: 'Whether the latest edit is saved.' },
    { path: 'doc.shared', type: 'boolean', default: false, description: 'Whether the doc is shared.' }
  ],
  invariants: [
    { name: 'Word count is non-negative', path: 'doc.wordCount', op: 'greater_than', value: -1, message: 'Word count can never be negative.' }
  ],
  actions: [
    {
      name: 'Save doc',
      intent: 'Persist the current document.',
      emits: 'doc.saved',
      roles: ['persistence'],
      params: [
        { name: 'body', type: 'string', description: 'Document body.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 100000 }] }
      ],
      rules: [{ category: 'business', description: 'Mark the doc saved.', set: { path: 'doc.saved', value: true } }]
    },
    {
      name: 'Share doc',
      intent: 'Share the document with a permission level.',
      emits: 'doc.shared',
      roles: ['primary'],
      params: [
        { name: 'permission', type: 'enum', description: 'Access level.', enumValues: ['view', 'comment', 'edit'] }
      ],
      rules: [
        { category: 'permissions', description: 'Record that the doc is shared.', set: { path: 'doc.shared', value: true } }
      ]
    }
  ]
});

const timeTracker = defineBrick({
  id: PRODUCTIVITY_IDS.timeTracker,
  name: 'Time tracker',
  category: 'productivity',
  surfaceType: 'dialog_area',
  summary: 'Start/stop timer with single-run and no-op guards.',
  description:
    'A stopwatch widget. Starting is blocked while a timer runs; stopping is blocked when none is running.',
  surfaceName: 'Timer',
  surfaceDescription: 'Track time against a task.',
  tags: ['productivity', 'time', 'tracker', 'timer'],
  states: [
    { path: 'timer.running', type: 'boolean', default: false, description: 'Whether the timer is active.' },
    { path: 'timer.elapsedSec', type: 'number', default: 0, description: 'Elapsed seconds.' }
  ],
  invariants: [
    { name: 'Elapsed is non-negative', path: 'timer.elapsedSec', op: 'greater_than', value: -1, message: 'Elapsed time can never be negative.' }
  ],
  actions: [
    {
      name: 'Start timer',
      intent: 'Begin timing.',
      emits: 'timer.started',
      roles: ['primary'],
      requiredStates: ['timer.running'],
      rules: [
        { category: 'async', when: { path: 'timer.running', op: 'is_true' }, block: 'A timer is already running.' },
        { category: 'business', description: 'Flag the timer running.', set: { path: 'timer.running', value: true } }
      ]
    },
    {
      name: 'Stop timer',
      intent: 'Stop timing.',
      emits: 'timer.stopped',
      roles: ['primary'],
      requiredStates: ['timer.running'],
      rules: [
        { category: 'business', when: { path: 'timer.running', op: 'is_false' }, block: 'No timer is running.' },
        { category: 'business', description: 'Clear the running flag.', set: { path: 'timer.running', value: false } }
      ]
    }
  ]
});

export const productivityBlueprints: readonly SurfaceBlueprint[] = [kanban, notes, timeTracker];
