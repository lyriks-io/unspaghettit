import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const FORMS_IDS = {
  wizard: 'library.forms.wizard',
  survey: 'library.forms.survey'
} as const;

const wizard = defineBrick({
  id: FORMS_IDS.wizard,
  name: 'Multi-step form',
  category: 'forms',
  surfaceType: 'workflow',
  summary: 'A stepped form with next/back bounds and a final submit gate.',
  description:
    'A generic wizard. Next stops at the last step, back stops at the first, and submit is blocked until every step is complete.',
  surfaceName: 'Steps',
  surfaceDescription: 'Walk a user through a form one step at a time.',
  tags: ['forms', 'wizard', 'multi-step', 'stepper'],
  states: [
    { path: 'form.step', type: 'number', default: 1, description: 'Current step (1-based).' },
    { path: 'form.totalSteps', type: 'number', default: 3, description: 'Total number of steps.' },
    { path: 'form.completed', type: 'boolean', default: false, description: 'True after a successful submit.' }
  ],
  invariants: [
    { name: 'Step is at least one', path: 'form.step', op: 'greater_than', value: 0, message: 'The current step is always 1 or greater.' }
  ],
  actions: [
    {
      name: 'Next step',
      intent: 'Advance to the next step.',
      emits: 'form.step.advanced',
      roles: ['primary'],
      requiredStates: ['form.step'],
      rules: [
        { category: 'business', when: { path: 'form.step', op: 'greater_than', value: 2 }, block: 'You are on the last step.' }
      ]
    },
    {
      name: 'Previous step',
      intent: 'Go back to the previous step.',
      emits: 'form.step.retreated',
      roles: ['primary'],
      requiredStates: ['form.step'],
      rules: [
        { category: 'business', when: { path: 'form.step', op: 'lower_than', value: 2 }, block: 'You are on the first step.' }
      ]
    },
    {
      name: 'Submit',
      intent: 'Submit the completed form.',
      emits: 'form.submitted',
      roles: ['primary', 'persistence'],
      requiredStates: ['form.step'],
      rules: [
        { category: 'business', when: { path: 'form.step', op: 'lower_than', value: 3 }, block: 'Complete all steps before submitting.' },
        { category: 'business', description: 'Mark the form complete.', set: { path: 'form.completed', value: true } }
      ]
    }
  ]
});

const survey = defineBrick({
  id: FORMS_IDS.survey,
  name: 'Survey',
  category: 'forms',
  surfaceType: 'screen',
  summary: 'Rating + comment survey with an optional skip.',
  description:
    'A short survey. Submitting validates a 1-5 rating and an optional comment; the respondent may also skip out.',
  surfaceName: 'Survey',
  surfaceDescription: 'Collect a rating and optional feedback from the user.',
  tags: ['forms', 'survey', 'feedback', 'nps'],
  states: [
    { path: 'survey.responseCount', type: 'number', default: 0, description: 'Responses collected.' },
    { path: 'survey.submitted', type: 'boolean', default: false, description: 'True once this respondent answered.' }
  ],
  invariants: [
    { name: 'Response count is non-negative', path: 'survey.responseCount', op: 'greater_than', value: -1, message: 'Response count can never be negative.' }
  ],
  actions: [
    {
      name: 'Submit response',
      intent: 'Record a survey response.',
      emits: 'survey.response.submitted',
      roles: ['primary'],
      params: [
        { name: 'rating', type: 'number', description: 'Score from 1 to 5.', validations: [{ type: 'min', value: 1 }, { type: 'max', value: 5 }, { type: 'integer' }] },
        { name: 'comment', type: 'string', description: 'Optional comment.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 1000 }] }
      ],
      rules: [{ category: 'business', description: 'Mark this respondent as answered.', set: { path: 'survey.submitted', value: true } }]
    },
    {
      name: 'Skip',
      intent: 'Dismiss the survey without answering.',
      emits: 'survey.skipped',
      roles: ['feedback'],
      rules: [{ category: 'ux_feedback', message: { text: 'Survey skipped.', tone: 'info' } }]
    }
  ]
});

export const formsBlueprints: readonly SurfaceBlueprint[] = [wizard, survey];
