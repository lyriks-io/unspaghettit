import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';

export const cookieConsentBlueprint: SurfaceBlueprint = {
  id: asBlueprintId('library.utility.cookie_consent'),
  name: 'Cookie consent',
  category: 'utility',
  surfaceType: 'dialog_area',
  summary: 'GDPR cookie banner with granular consent toggles.',
  description:
    'Modal dialog shown on first visit. The visitor accepts/rejects analytics, marketing, and functional cookies; choices persist in local storage and are auditable.',
  platforms: ['web', 'mobile'],
  tags: ['gdpr', 'consent', 'cookies', 'compliance', 'modal'],
  build: ({ ids, ownSurfaceId }) => {
    const consentResourceId = asResourceId('library-utility-res-consent-log');
    return {
      surface: {
        id: ownSurfaceId,
        name: 'Cookie consent',
        type: 'dialog_area',
        description:
          'Modal banner. Visitors accept all, reject non-essential, or pick categories.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('consent.required'),
            type: 'boolean',
            defaultValue: true,
            description: 'True until the visitor has made a choice.'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('consent.analytics'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('consent.marketing'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('consent.functional'),
            type: 'boolean',
            defaultValue: true,
            description: 'Strictly-necessary cookies. Always on, not togglable.'
          }
        ],
        rules: [],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'consent.functional is always true',
            condition: { left: asStatePath('consent.functional'), operator: 'is_true' },
            message: 'Functional cookies are strictly necessary and cannot be disabled.'
          }
        ],
        transitions: [],
        actions: [
          {
            id: asActionId(ids()),
            name: 'Save preferences',
            intent: 'Persist the chosen consent toggles and dismiss the banner.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'analytics',
                type: 'boolean',
                required: true,
                defaultValue: false,
                description: 'Allow analytics cookies. Bound to consent.analytics.',
                resourceId: consentResourceId,
                bindToStatePath: asStatePath('consent.analytics')
              },
              {
                id: asParameterId(ids()),
                name: 'marketing',
                type: 'boolean',
                required: true,
                defaultValue: false,
                description: 'Allow marketing cookies. Bound to consent.marketing.',
                resourceId: consentResourceId,
                bindToStatePath: asStatePath('consent.marketing')
              }
            ],
            requiredStates: [asStatePath('consent.required'), asStatePath('consent.functional')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: { left: asStatePath('consent.functional'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Functional cookies cannot be disabled.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('consent.required'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Consent already recorded.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('consent.required'),
                value: false
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('consent.recorded')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Preferences saved.',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('consent.recorded')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Accept all',
                description: 'Visitor opts in to everything.',
                stateOverrides: [{ path: asStatePath('consent.required'), value: true }],
                parameterOverrides: [
                  { parameterName: 'analytics', value: true },
                  { parameterName: 'marketing', value: true }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Reject non-essential',
                description: 'Visitor disables analytics and marketing.',
                stateOverrides: [{ path: asStatePath('consent.required'), value: true }],
                parameterOverrides: [
                  { parameterName: 'analytics', value: false },
                  { parameterName: 'marketing', value: false }
                ]
              }
            ]
          }
        ]
      },
      resources: [
        {
          id: consentResourceId,
          name: 'Consent log (Postgres)',
          description: 'Append-only log of consent choices for compliance audits.',
          kind: 'relational_db',
          provider: 'PostgreSQL',
          scope: 'cloud',
          location: 'eu-west',
          database: 'compliance',
          container: 'consent_log',
          field: undefined,
          sensitivity: 'confidential',
          containsPii: true,
          complianceTags: ['gdpr'],
          accessMode: 'write',
          authentication: 'iam_role',
          encryptionAtRest: true,
          encryptionInTransit: true,
          retention: '7 years',
          owner: 'compliance-team'
        }
      ]
    };
  }
};
