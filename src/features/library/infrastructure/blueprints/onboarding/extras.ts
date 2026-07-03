import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

/** Onboarding bricks beyond the wizard: a checklist and an empty state. */

const welcomeChecklist = defineBrick({
  id: 'library.onboarding.welcome_checklist',
  name: 'Welcome checklist',
  category: 'onboarding',
  surfaceType: 'screen',
  summary: 'A getting-started checklist with per-step completion and dismiss.',
  description:
    'The classic activation checklist. Completing a step emits an event a progress bar can track; the whole card can be dismissed.',
  surfaceName: 'Get started',
  surfaceDescription: 'Guide a new user through their first key actions.',
  tags: ['onboarding', 'checklist', 'activation', 'getting-started'],
  states: [
    { path: 'onboarding.completedSteps', type: 'number', default: 0, description: 'Steps completed so far.' },
    { path: 'onboarding.totalSteps', type: 'number', default: 4, description: 'Total steps in the checklist.' },
    { path: 'onboarding.dismissed', type: 'boolean', default: false, description: 'Whether the card was dismissed.' }
  ],
  invariants: [
    { name: 'Completed steps is non-negative', path: 'onboarding.completedSteps', op: 'greater_than', value: -1, message: 'Completed steps can never be negative.' }
  ],
  actions: [
    {
      name: 'Complete step',
      intent: 'Mark a checklist step as done.',
      emits: 'onboarding.step.completed',
      roles: ['primary'],
      requiredStates: ['onboarding.dismissed'],
      params: [
        { name: 'stepId', type: 'enum', description: 'Which step.', enumValues: ['profile', 'invite', 'connect', 'explore'] }
      ],
      rules: [
        { category: 'business', when: { path: 'onboarding.dismissed', op: 'is_true' }, block: 'The checklist was dismissed. Reopen it to continue.' }
      ]
    },
    {
      name: 'Dismiss',
      intent: 'Hide the checklist.',
      emits: 'onboarding.dismissed',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Mark the checklist dismissed.', set: { path: 'onboarding.dismissed', value: true } }]
    }
  ]
});

const emptyState = defineBrick({
  id: 'library.onboarding.empty_state',
  name: 'Empty state',
  category: 'onboarding',
  surfaceType: 'screen',
  summary: 'A zero-data placeholder with a primary CTA and a sample importer.',
  description:
    'The screen a list shows before it has any data. A primary CTA nudges creation, and a sample importer seeds example content.',
  surfaceName: 'Nothing here yet',
  surfaceDescription: 'Encourage the first action when a collection is empty.',
  tags: ['onboarding', 'empty-state', 'zero-data', 'cta'],
  states: [
    { path: 'emptyState.hasItems', type: 'boolean', default: false, description: 'Whether any items exist yet.' },
    { path: 'emptyState.ctaClicks', type: 'number', default: 0, description: 'Primary CTA clicks.' }
  ],
  invariants: [
    { name: 'CTA clicks is non-negative', path: 'emptyState.ctaClicks', op: 'greater_than', value: -1, message: 'CTA click count can never be negative.' }
  ],
  actions: [
    {
      name: 'Create first item',
      intent: 'Kick off creating the first item.',
      emits: 'empty_state.cta.clicked',
      roles: ['primary'],
      rules: [{ category: 'ux_feedback', message: { text: 'Let us create your first one.', tone: 'info' } }]
    },
    {
      name: 'Import sample',
      intent: 'Seed the collection with example data.',
      emits: 'empty_state.sample.imported',
      roles: ['primary'],
      rules: [{ category: 'business', description: 'Record that items now exist.', set: { path: 'emptyState.hasItems', value: true } }]
    }
  ]
});

export const onboardingExtraBlueprints: readonly SurfaceBlueprint[] = [welcomeChecklist, emptyState];
