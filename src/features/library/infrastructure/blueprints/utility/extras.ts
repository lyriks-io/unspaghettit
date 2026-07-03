import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

/** Small, reusable utility bricks that show up in almost every product. */

const confirmDialog = defineBrick({
  id: 'library.utility.confirm_dialog',
  name: 'Confirmation dialog',
  category: 'utility',
  surfaceType: 'dialog_area',
  summary: 'A reusable confirm / cancel dialog with a danger flag.',
  description:
    'The generic "are you sure?" modal. Confirm records the decision; cancel closes without side effects. A danger flag drives destructive styling.',
  surfaceName: 'Confirm',
  surfaceDescription: 'Ask the user to confirm or cancel an action.',
  tags: ['utility', 'dialog', 'confirm', 'modal'],
  states: [
    { path: 'confirm.open', type: 'boolean', default: false, description: 'Whether the dialog is open.' },
    { path: 'confirm.confirmed', type: 'boolean', default: false, description: 'Whether the user confirmed.' },
    { path: 'confirm.danger', type: 'boolean', default: false, description: 'Whether this is a destructive confirmation.' }
  ],
  invariants: [
    { name: 'Confirmed flag is observable', path: 'confirm.confirmed', op: 'exists', message: 'The confirmed flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Confirm',
      intent: 'Accept the pending action.',
      emits: 'dialog.confirmed',
      roles: ['primary'],
      rules: [{ category: 'business', description: 'Record the confirmation and close.', set: { path: 'confirm.confirmed', value: true } }]
    },
    {
      name: 'Cancel',
      intent: 'Dismiss the dialog without acting.',
      emits: 'dialog.cancelled',
      roles: ['feedback'],
      rules: [{ category: 'business', description: 'Close the dialog.', set: { path: 'confirm.open', value: false } }]
    }
  ]
});

const feedbackWidget = defineBrick({
  id: 'library.utility.feedback_widget',
  name: 'Feedback widget',
  category: 'utility',
  surfaceType: 'dialog_area',
  summary: 'A floating sentiment + comment capture with a submitted flag.',
  description:
    'The little "How are we doing?" launcher. Submitting captures a sentiment enum and an optional comment; opening just reveals the form.',
  surfaceName: 'Feedback',
  surfaceDescription: 'Collect quick sentiment and free-text feedback.',
  tags: ['utility', 'feedback', 'sentiment', 'widget'],
  states: [
    { path: 'feedback.submitted', type: 'boolean', default: false, description: 'True after a successful submit.' },
    { path: 'feedback.sentiment', type: 'enum', default: 'neutral', description: 'Captured sentiment.', enumValues: ['positive', 'neutral', 'negative'] }
  ],
  invariants: [
    { name: 'Submitted flag is observable', path: 'feedback.submitted', op: 'exists', message: 'The submitted flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Open widget',
      intent: 'Reveal the feedback form.',
      emits: 'feedback.opened',
      roles: ['entry'],
      rules: [{ category: 'ux_feedback', message: { text: 'Tell us what you think.', tone: 'info' } }]
    },
    {
      name: 'Submit feedback',
      intent: 'Record the sentiment and comment.',
      emits: 'feedback.submitted',
      roles: ['primary'],
      params: [
        { name: 'sentiment', type: 'enum', description: 'How the user feels.', enumValues: ['positive', 'neutral', 'negative'], bindTo: 'feedback.sentiment' },
        { name: 'comment', type: 'string', description: 'Optional detail.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 1000 }] }
      ],
      rules: [{ category: 'business', description: 'Mark the feedback submitted.', set: { path: 'feedback.submitted', value: true } }]
    }
  ]
});

const languageSwitcher = defineBrick({
  id: 'library.utility.language_switcher',
  name: 'Language switcher',
  category: 'utility',
  surfaceType: 'dialog_area',
  summary: 'A locale picker that persists the choice and emits a change event.',
  description:
    'A compact locale menu. Selecting a language binds the choice into state and emits an event the app can use to re-render translated copy.',
  surfaceName: 'Language',
  surfaceDescription: 'Let the user pick the interface language.',
  tags: ['utility', 'i18n', 'locale', 'language'],
  states: [
    { path: 'locale.current', type: 'enum', default: 'en', description: 'Active locale.', enumValues: ['en', 'fr', 'es', 'de', 'ja'] }
  ],
  invariants: [
    { name: 'A locale is always set', path: 'locale.current', op: 'exists', message: 'The interface always has an active locale.' }
  ],
  actions: [
    {
      name: 'Set language',
      intent: 'Switch the interface language.',
      emits: 'locale.changed',
      roles: ['primary'],
      params: [
        { name: 'locale', type: 'enum', description: 'Target locale.', enumValues: ['en', 'fr', 'es', 'de', 'ja'], bindTo: 'locale.current' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Language updated.', tone: 'success' } }]
    }
  ]
});

export const utilityExtraBlueprints: readonly SurfaceBlueprint[] = [
  confirmDialog,
  feedbackWidget,
  languageSwitcher
];
