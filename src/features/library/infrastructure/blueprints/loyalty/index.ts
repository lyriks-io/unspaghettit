import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const LOYALTY_IDS = {
  rewards: 'library.loyalty.rewards',
  referral: 'library.loyalty.referral'
} as const;

const rewards = defineBrick({
  id: LOYALTY_IDS.rewards,
  name: 'Rewards',
  category: 'loyalty',
  surfaceType: 'screen',
  summary: 'Points balance with tiered benefits and guarded redemption.',
  description:
    'A loyalty dashboard. Redeeming is blocked with zero points and validates the cost; viewing benefits switches the shown tier.',
  surfaceName: 'Rewards',
  surfaceDescription: 'Track points and redeem rewards.',
  tags: ['loyalty', 'rewards', 'points', 'tiers'],
  siblings: [{ id: LOYALTY_IDS.referral, label: 'Refer a friend' }],
  states: [
    { path: 'rewards.points', type: 'number', default: 0, description: 'Available points.' },
    { path: 'rewards.tier', type: 'enum', default: 'bronze', description: 'Loyalty tier.', enumValues: ['bronze', 'silver', 'gold', 'platinum'] }
  ],
  invariants: [
    { name: 'Points are non-negative', path: 'rewards.points', op: 'greater_than', value: -1, message: 'Points can never be negative.' }
  ],
  actions: [
    {
      name: 'Redeem reward',
      intent: 'Spend points on a reward.',
      emits: 'loyalty.reward.redeemed',
      roles: ['primary'],
      requiredStates: ['rewards.points'],
      params: [
        { name: 'rewardId', type: 'string', description: 'Reward id.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] },
        { name: 'cost', type: 'number', description: 'Point cost.', validations: [{ type: 'min', value: 1 }, { type: 'integer' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'rewards.points', op: 'equals', value: 0 }, block: 'You have no points to redeem.' }
      ]
    },
    {
      name: 'View tier benefits',
      intent: 'Show benefits for a tier.',
      emits: 'loyalty.tier.viewed',
      roles: ['primary'],
      params: [
        { name: 'tier', type: 'enum', description: 'Tier to inspect.', enumValues: ['bronze', 'silver', 'gold', 'platinum'], bindTo: 'rewards.tier' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Showing tier benefits.', tone: 'info' } }]
    }
  ]
});

const referral = defineBrick({
  id: LOYALTY_IDS.referral,
  name: 'Referral',
  category: 'loyalty',
  surfaceType: 'dialog_area',
  summary: 'Invite friends by email and copy a referral link.',
  description:
    'A refer-a-friend widget. Sending validates the invitee email and counts the invite; copying the link is a quick feedback action.',
  surfaceName: 'Refer a friend',
  surfaceDescription: 'Invite others and earn referral rewards.',
  tags: ['loyalty', 'referral', 'invite', 'growth'],
  states: [
    { path: 'referral.invitesSent', type: 'number', default: 0, description: 'Invitations sent.' },
    { path: 'referral.rewardCents', type: 'number', default: 1000, description: 'Reward per successful referral, in cents.' }
  ],
  invariants: [
    { name: 'Invites sent is non-negative', path: 'referral.invitesSent', op: 'greater_than', value: -1, message: 'Invites sent can never be negative.' }
  ],
  actions: [
    {
      name: 'Send referral',
      intent: 'Invite a friend by email.',
      emits: 'loyalty.referral.sent',
      roles: ['primary'],
      params: [
        { name: 'email', type: 'email', description: 'Invitee email.', validations: [{ type: 'non_empty' }, { type: 'email' }] }
      ],
      rules: [{ category: 'business', description: 'Count the sent invite.', set: { path: 'referral.invitesSent', value: 1 } }]
    },
    {
      name: 'Copy link',
      intent: 'Copy the personal referral link.',
      emits: 'loyalty.referral.link_copied',
      roles: ['feedback'],
      rules: [{ category: 'ux_feedback', message: { text: 'Referral link copied.', tone: 'success' } }]
    }
  ]
});

export const loyaltyBlueprints: readonly SurfaceBlueprint[] = [rewards, referral];
