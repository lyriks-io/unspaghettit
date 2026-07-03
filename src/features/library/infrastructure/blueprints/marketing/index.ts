import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const MARKETING_IDS = {
  landing: 'library.marketing.landing',
  pricing: 'library.marketing.pricing',
  newsletter: 'library.marketing.newsletter'
} as const;

const landing = defineBrick({
  id: MARKETING_IDS.landing,
  name: 'Landing page',
  category: 'marketing',
  surfaceType: 'screen',
  summary: 'Hero with a tracked primary CTA and an A/B variant flag.',
  description:
    'A conversion-focused landing page. The CTA click and page view both emit analytics events, and the layout variant is an explicit enum for experiments.',
  surfaceName: 'Landing',
  surfaceDescription: 'Present the value proposition and drive a primary action.',
  tags: ['marketing', 'landing', 'cta', 'conversion', 'ab-test'],
  siblings: [{ id: MARKETING_IDS.pricing, label: 'Pricing' }],
  states: [
    { path: 'landing.ctaClicks', type: 'number', default: 0, description: 'CTA clicks this session.' },
    { path: 'landing.variant', type: 'enum', default: 'a', description: 'A/B layout variant.', enumValues: ['a', 'b'] }
  ],
  invariants: [
    { name: 'Click count is non-negative', path: 'landing.ctaClicks', op: 'greater_than', value: -1, message: 'The CTA click count can never be negative.' }
  ],
  actions: [
    {
      name: 'Click CTA',
      intent: 'Follow the page primary call to action.',
      emits: 'landing.cta.clicked',
      roles: ['primary'],
      params: [
        { name: 'target', type: 'enum', description: 'Where the CTA leads.', enumValues: ['signup', 'demo', 'docs'] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Taking you there.', tone: 'info' } }]
    },
    {
      name: 'Track view',
      intent: 'Record a page view for analytics.',
      emits: 'landing.viewed',
      roles: ['feedback'],
      rules: [{ category: 'audit', message: { text: 'Page view recorded.', tone: 'info' } }]
    }
  ]
});

const pricing = defineBrick({
  id: MARKETING_IDS.pricing,
  name: 'Pricing page',
  category: 'marketing',
  surfaceType: 'screen',
  summary: 'Monthly/annual toggle and plan selection that emits intent.',
  description:
    'The pricing table. The billing-cycle toggle and plan selection are explicit enums; selecting a plan emits an intent event a signup flow can pick up.',
  surfaceName: 'Pricing',
  surfaceDescription: 'Compare plans and pick one to start signup.',
  tags: ['marketing', 'pricing', 'plans'],
  siblings: [{ id: MARKETING_IDS.newsletter, label: 'Newsletter' }],
  states: [
    { path: 'pricing.billingCycle', type: 'enum', default: 'monthly', description: 'Billing cycle shown.', enumValues: ['monthly', 'annual'] },
    { path: 'pricing.selectedPlan', type: 'enum', default: 'pro', description: 'Highlighted plan.', enumValues: ['free', 'pro', 'enterprise'] }
  ],
  invariants: [
    { name: 'A plan is always highlighted', path: 'pricing.selectedPlan', op: 'exists', message: 'The pricing page always highlights a plan.' }
  ],
  actions: [
    {
      name: 'Toggle billing cycle',
      intent: 'Switch prices between monthly and annual.',
      emits: 'pricing.cycle.toggled',
      roles: ['primary'],
      params: [
        { name: 'cycle', type: 'enum', description: 'Billing cycle.', enumValues: ['monthly', 'annual'], bindTo: 'pricing.billingCycle' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Prices updated.', tone: 'info' } }]
    },
    {
      name: 'Select plan',
      intent: 'Choose a plan to begin signup.',
      emits: 'pricing.plan.selected',
      roles: ['primary'],
      params: [
        { name: 'plan', type: 'enum', description: 'Chosen plan.', enumValues: ['free', 'pro', 'enterprise'], bindTo: 'pricing.selectedPlan' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Plan selected.', tone: 'success' } }]
    }
  ]
});

const newsletter = defineBrick({
  id: MARKETING_IDS.newsletter,
  name: 'Newsletter signup',
  category: 'marketing',
  surfaceType: 'dialog_area',
  summary: 'Email capture with a double-opt-in consent gate.',
  description:
    'A lightweight subscribe widget. The email is validated and subscription is blocked until the visitor explicitly consents to receive email.',
  surfaceName: 'Subscribe',
  surfaceDescription: 'Capture an email address for the mailing list.',
  tags: ['marketing', 'newsletter', 'email', 'consent', 'opt-in'],
  states: [
    { path: 'newsletter.consent', type: 'boolean', default: false, description: 'Whether the visitor agreed to email.' },
    { path: 'newsletter.subscribed', type: 'boolean', default: false, description: 'True after a successful subscribe.' }
  ],
  invariants: [
    { name: 'Subscribed flag is observable', path: 'newsletter.subscribed', op: 'exists', message: 'The subscribed flag must always be readable.' }
  ],
  actions: [
    {
      name: 'Subscribe',
      intent: 'Add an email to the mailing list.',
      emits: 'newsletter.subscribed',
      roles: ['primary'],
      requiredStates: ['newsletter.consent'],
      params: [
        { name: 'email', type: 'email', description: 'Subscriber email.', validations: [{ type: 'non_empty' }, { type: 'email' }] },
        { name: 'consent', type: 'boolean', description: 'Agreement to receive email.', bindTo: 'newsletter.consent' }
      ],
      rules: [
        { category: 'compliance', when: { path: 'newsletter.consent', op: 'is_false' }, block: 'Confirm you agree to receive email to subscribe.' },
        { category: 'business', description: 'Mark the visitor subscribed.', set: { path: 'newsletter.subscribed', value: true } }
      ]
    }
  ]
});

export const marketingBlueprints: readonly SurfaceBlueprint[] = [landing, pricing, newsletter];
