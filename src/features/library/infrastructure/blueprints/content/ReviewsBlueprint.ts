import type { Resource } from '$features/behavior-model/domain/entities/Resource';
import {
  asActionId,
  asEffectId,
  asInvariantId,
  asParameterId,
  asResourceId,
  asRuleId,
  asScenarioId,
  asStateDefinitionId,
  asTransitionId
} from '$features/behavior-model/domain/value-objects/ids';
import { asEventName } from '$features/behavior-model/domain/value-objects/EventName';
import { asStatePath } from '$features/behavior-model/domain/value-objects/StatePath';
import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { asBlueprintId } from '../../../domain/value-objects/BlueprintId';
import { COMMERCE_BLUEPRINT_IDS } from '../commerce/shared';

const reviewsBlueprintId = asBlueprintId('library.content.reviews');
const reviewsResourceId = asResourceId('library-content-res-reviews');
const moderationResourceId = asResourceId('library-content-res-moderation');

const reviewsResources: readonly Resource[] = [
  {
    id: reviewsResourceId,
    name: 'Product reviews (DynamoDB)',
    description: 'Customer-written reviews. Public read, moderated write. PII via reviewer name.',
    kind: 'document_db',
    provider: 'AWS DynamoDB',
    scope: 'cloud',
    location: 'eu-west',
    database: 'commerce',
    container: 'product-reviews',
    field: undefined,
    sensitivity: 'internal',
    containsPii: true,
    complianceTags: ['gdpr'],
    accessMode: 'read_write',
    authentication: 'iam_role',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: 'until product delisted + 1 year',
    owner: 'community-team'
  },
  {
    id: moderationResourceId,
    name: 'Text moderation API',
    description: 'External moderation API used to flag profanity in user-generated text.',
    kind: 'http_api',
    provider: 'Perspective API',
    scope: 'external',
    location: 'us-east',
    database: 'https://commentanalyzer.googleapis.com',
    container: '/v1alpha1/comments:analyze',
    field: undefined,
    sensitivity: 'internal',
    containsPii: true,
    complianceTags: ['gdpr'],
    accessMode: 'read_write',
    authentication: 'api_key',
    encryptionAtRest: true,
    encryptionInTransit: true,
    retention: 'managed by provider',
    owner: 'trust-and-safety-team'
  }
];

export const reviewsBlueprint: SurfaceBlueprint = {
  id: reviewsBlueprintId,
  name: 'Reviews',
  category: 'content',
  surfaceType: 'screen',
  summary: 'Read, filter, and submit product reviews with profanity moderation.',
  description:
    'A reviews surface for any catalog item. Filter by minimum stars or verified-only, submit a new review (moderated), or upvote helpful ones. Cross-links to Product details when both bundles are present.',
  platforms: ['web', 'mobile'],
  tags: ['reviews', 'comments', 'rating', 'moderation', 'community'],
  siblings: [COMMERCE_BLUEPRINT_IDS.productDetails],
  build: ({ ids, ownSurfaceId, linkTargets }) => {
    const transitions = [
      linkTargets.get(COMMERCE_BLUEPRINT_IDS.productDetails) && {
        id: asTransitionId(ids()),
        target: linkTargets.get(COMMERCE_BLUEPRINT_IDS.productDetails)!,
        label: 'Back to product'
      }
    ].filter((t): t is NonNullable<typeof t> => Boolean(t));

    return {
      surface: {
        id: ownSurfaceId,
        name: 'Reviews',
        type: 'screen',
        description:
          'Browse and submit reviews for the product currently in product.viewing.',
        stateDefinitions: [
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('product.viewing'),
            type: 'string',
            defaultValue: ''
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('reviews.filter.minRating'),
            type: 'number',
            defaultValue: 1,
            description: 'Minimum-stars filter. Bound from "minRating".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('review.rating'),
            type: 'number',
            defaultValue: 5,
            description: 'Star rating typed by the user. Bound from "rating".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('review.text'),
            type: 'string',
            defaultValue: '',
            description: 'Review body. Bound from "reviewText".'
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('review.profanityFlagged'),
            type: 'boolean',
            defaultValue: false
          },
          {
            id: asStateDefinitionId(ids()),
            path: asStatePath('user.authenticated'),
            type: 'boolean',
            defaultValue: false
          }
        ],
        rules: [
          {
            id: asRuleId(ids()),
            category: 'permissions',
            condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
            effect: {
              id: asEffectId(ids()),
              type: 'show_message',
              message: 'Sign in to submit or vote on reviews.',
              tone: 'info'
            },
            description: 'Surface-level hint for guests; specific actions still gate.'
          }
        ],
        invariants: [
          {
            id: asInvariantId(ids()),
            name: 'review.rating in [1, 5]',
            condition: {
              left: asStatePath('review.rating'),
              operator: 'greater_than',
              right: 0
            },
            message: 'Rating must be at least 1 star.'
          }
        ],
        transitions,
        actions: [
          {
            id: asActionId(ids()),
            name: 'Filter reviews',
            intent: 'Narrow the list by minimum rating.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'minRating',
                type: 'number',
                required: true,
                description: 'Minimum stars to show. Bound to reviews.filter.minRating.',
                resourceId: reviewsResourceId,
                bindToStatePath: asStatePath('reviews.filter.minRating'),
                validations: [
                  { type: 'min', value: 1 },
                  { type: 'max', value: 5 },
                  { type: 'integer' }
                ]
              }
            ],
            requiredStates: [asStatePath('reviews.filter.minRating')],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: {
                  left: asStatePath('reviews.filter.minRating'),
                  operator: 'lower_than',
                  right: 1
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Minimum rating must be at least 1.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'ux_feedback',
                condition: {
                  left: asStatePath('reviews.filter.minRating'),
                  operator: 'equals',
                  right: 5
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'show_message',
                  message: 'Only 5-star reviews shown. Widen the filter for balance.',
                  tone: 'info'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('reviews.filtered')
              }
            ],
            emittedEvents: [asEventName('reviews.filtered')],
            transitions: []
          },
          {
            id: asActionId(ids()),
            name: 'Submit review',
            intent: 'Post a customer review of the focused product.',
            parameters: [
              {
                id: asParameterId(ids()),
                name: 'rating',
                type: 'number',
                required: true,
                description: 'Star rating 1–5. Bound to review.rating.',
                resourceId: reviewsResourceId,
                bindToStatePath: asStatePath('review.rating'),
                validations: [
                  { type: 'min', value: 1 },
                  { type: 'max', value: 5 },
                  { type: 'integer' }
                ]
              },
              {
                id: asParameterId(ids()),
                name: 'reviewText',
                type: 'string',
                required: true,
                description: 'Free-text review body. Bound to review.text.',
                resourceId: reviewsResourceId,
                bindToStatePath: asStatePath('review.text'),
                validations: [
                  { type: 'non_empty' },
                  { type: 'min_length', value: 10 },
                  { type: 'max_length', value: 5000 }
                ]
              }
            ],
            requiredStates: [
              asStatePath('review.rating'),
              asStatePath('review.text'),
              asStatePath('review.profanityFlagged'),
              asStatePath('user.authenticated')
            ],
            rules: [
              {
                id: asRuleId(ids()),
                category: 'permissions',
                condition: { left: asStatePath('user.authenticated'), operator: 'is_false' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Sign in to submit a review.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'compliance',
                condition: { left: asStatePath('review.profanityFlagged'), operator: 'is_true' },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Review violates community guidelines.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'business',
                condition: {
                  left: asStatePath('review.text'),
                  operator: 'contains',
                  right: 'http'
                },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Reviews cannot contain links.'
                }
              },
              {
                id: asRuleId(ids()),
                category: 'validation',
                condition: { left: asStatePath('review.rating'), operator: 'lower_than', right: 1 },
                effect: {
                  id: asEffectId(ids()),
                  type: 'block_action',
                  reason: 'Pick a rating between 1 and 5.'
                }
              }
            ],
            invariants: [],
            effects: [
              {
                id: asEffectId(ids()),
                type: 'set_state',
                path: asStatePath('review.profanityFlagged'),
                value: false
              },
              {
                id: asEffectId(ids()),
                type: 'emit_event',
                event: asEventName('review.submitted')
              },
              {
                id: asEffectId(ids()),
                type: 'show_message',
                message: 'Thanks. Your review is published.',
                tone: 'success'
              }
            ],
            emittedEvents: [asEventName('review.submitted')],
            transitions: [],
            scenarios: [
              {
                id: asScenarioId(ids()),
                name: 'Guest tries to post',
                description: 'Unauthenticated user. Permissions rule blocks.',
                stateOverrides: [{ path: asStatePath('user.authenticated'), value: false }],
                parameterOverrides: [
                  { parameterName: 'rating', value: 5 },
                  { parameterName: 'reviewText', value: 'Loved it. Buying again.' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Contains a link',
                description: 'Review body has "http". No-links rule blocks.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('review.profanityFlagged'), value: false }
                ],
                parameterOverrides: [
                  { parameterName: 'rating', value: 1 },
                  { parameterName: 'reviewText', value: 'Bad. See https://example.com' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Profanity flagged',
                description: 'Moderation API flagged the text. Compliance rule blocks.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('review.profanityFlagged'), value: true }
                ],
                parameterOverrides: [
                  { parameterName: 'rating', value: 2 },
                  { parameterName: 'reviewText', value: 'Average quality, fits my needs.' }
                ]
              },
              {
                id: asScenarioId(ids()),
                name: 'Happy path',
                description: 'Authenticated, clean text. Review posts.',
                stateOverrides: [
                  { path: asStatePath('user.authenticated'), value: true },
                  { path: asStatePath('review.profanityFlagged'), value: false }
                ],
                parameterOverrides: [
                  { parameterName: 'rating', value: 5 },
                  { parameterName: 'reviewText', value: 'Loved it. Buying again.' }
                ]
              }
            ]
          }
        ]
      },
      resources: reviewsResources
    };
  }
};
