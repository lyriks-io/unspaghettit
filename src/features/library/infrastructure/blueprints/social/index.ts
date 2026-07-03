import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

export const SOCIAL_IDS = {
  profile: 'library.social.profile',
  feed: 'library.social.feed',
  composer: 'library.social.composer'
} as const;

const profile = defineBrick({
  id: SOCIAL_IDS.profile,
  name: 'Public profile',
  category: 'social',
  surfaceType: 'screen',
  summary: 'Follow / unfollow a public profile with idempotent guards.',
  description:
    'A visitor-facing profile page. Following and unfollowing are guarded so the same action cannot be applied twice, keeping the follower count honest.',
  surfaceName: 'Profile',
  surfaceDescription: 'View a public profile and follow or unfollow the account.',
  tags: ['social', 'profile', 'follow', 'network'],
  siblings: [{ id: SOCIAL_IDS.feed, label: 'Feed' }],
  states: [
    { path: 'publicProfile.userId', type: 'string', default: '', description: 'Id of the profile being viewed.' },
    { path: 'publicProfile.following', type: 'boolean', default: false, description: 'Whether the viewer follows this account.' },
    { path: 'publicProfile.followerCount', type: 'number', default: 0, description: 'Follower total.' }
  ],
  invariants: [
    { name: 'Follower count is non-negative', path: 'publicProfile.followerCount', op: 'greater_than', value: -1, message: 'Follower count can never be negative.' }
  ],
  actions: [
    {
      name: 'Follow',
      intent: 'Start following this account.',
      emits: 'social.followed',
      roles: ['primary'],
      requiredStates: ['publicProfile.following'],
      rules: [
        { category: 'business', when: { path: 'publicProfile.following', op: 'is_true' }, block: 'You already follow this account.' },
        { category: 'business', description: 'Mark the viewer as following.', set: { path: 'publicProfile.following', value: true } }
      ]
    },
    {
      name: 'Unfollow',
      intent: 'Stop following this account.',
      emits: 'social.unfollowed',
      roles: ['primary'],
      requiredStates: ['publicProfile.following'],
      rules: [
        { category: 'business', when: { path: 'publicProfile.following', op: 'is_false' }, block: 'You are not following this account.' },
        { category: 'business', description: 'Clear the following flag.', set: { path: 'publicProfile.following', value: false } }
      ]
    }
  ]
});

const feed = defineBrick({
  id: SOCIAL_IDS.feed,
  name: 'Activity feed',
  category: 'social',
  surfaceType: 'screen',
  summary: 'Infinite feed with filters, likes, and a loading guard.',
  description:
    'A scrolling feed. Loading more is blocked while a fetch is in flight; likes and filter changes emit events other surfaces can react to.',
  surfaceName: 'Feed',
  surfaceDescription: 'Scroll a personalised feed, like posts, and change the feed filter.',
  tags: ['social', 'feed', 'timeline', 'likes'],
  siblings: [{ id: SOCIAL_IDS.composer, label: 'New post' }],
  states: [
    { path: 'feed.itemCount', type: 'number', default: 0, description: 'Items currently loaded.' },
    { path: 'feed.loading', type: 'boolean', default: false, description: 'True while a page is being fetched.' },
    { path: 'feed.filter', type: 'enum', default: 'all', description: 'Feed filter.', enumValues: ['all', 'following', 'popular'] }
  ],
  invariants: [
    { name: 'Item count is non-negative', path: 'feed.itemCount', op: 'greater_than', value: -1, message: 'Feed item count can never be negative.' }
  ],
  actions: [
    {
      name: 'Load more',
      intent: 'Fetch the next page of feed items.',
      emits: 'feed.page.loaded',
      roles: ['async'],
      requiredStates: ['feed.loading'],
      rules: [
        { category: 'async', when: { path: 'feed.loading', op: 'is_true' }, block: 'A page is already loading.' }
      ]
    },
    {
      name: 'Like post',
      intent: 'Like a post in the feed.',
      emits: 'feed.post.liked',
      roles: ['primary'],
      params: [
        { name: 'postId', type: 'string', description: 'Id of the post to like.', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Liked.', tone: 'success' } }]
    },
    {
      name: 'Set filter',
      intent: 'Change which posts the feed shows.',
      emits: 'feed.filter.changed',
      roles: ['primary'],
      params: [
        { name: 'filter', type: 'enum', description: 'Feed filter.', enumValues: ['all', 'following', 'popular'], bindTo: 'feed.filter' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Filter applied.', tone: 'info' } }]
    }
  ]
});

const composer = defineBrick({
  id: SOCIAL_IDS.composer,
  name: 'Post composer',
  category: 'social',
  surfaceType: 'dialog_area',
  summary: 'Compose a post with a character limit, visibility, and draft save.',
  description:
    'The create-post modal. Publishing is blocked while a post is in flight and clears the draft on success; visibility is an explicit enum.',
  surfaceName: 'New post',
  surfaceDescription: 'Write, set visibility for, and publish a new post.',
  tags: ['social', 'composer', 'post', 'publish'],
  states: [
    { path: 'composer.draft', type: 'string', default: '', description: 'Draft body text.' },
    { path: 'composer.posting', type: 'boolean', default: false, description: 'True while publishing.' },
    { path: 'composer.visibility', type: 'enum', default: 'public', description: 'Who can see the post.', enumValues: ['public', 'followers', 'private'] }
  ],
  invariants: [
    { name: 'Draft slot exists', path: 'composer.draft', op: 'exists', message: 'The composer must always carry a draft value.' }
  ],
  actions: [
    {
      name: 'Publish post',
      intent: 'Publish the composed post.',
      emits: 'post.published',
      roles: ['primary'],
      requiredStates: ['composer.posting'],
      params: [
        { name: 'body', type: 'string', description: 'Post text.', bindTo: 'composer.draft', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 280 }] },
        { name: 'visibility', type: 'enum', description: 'Visibility.', enumValues: ['public', 'followers', 'private'], bindTo: 'composer.visibility' }
      ],
      rules: [
        { category: 'async', when: { path: 'composer.posting', op: 'is_true' }, block: 'A post is already being published.' },
        { category: 'business', description: 'Clear the draft after publishing.', set: { path: 'composer.draft', value: '' } }
      ]
    },
    {
      name: 'Save draft',
      intent: 'Persist the current text as a draft.',
      emits: 'post.draft.saved',
      roles: ['persistence'],
      params: [
        { name: 'body', type: 'string', description: 'Draft text.', required: false, defaultValue: '', bindTo: 'composer.draft', validations: [{ type: 'max_length', value: 280 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Draft saved.', tone: 'success' } }]
    }
  ]
});

export const socialBlueprints: readonly SurfaceBlueprint[] = [profile, feed, composer];
