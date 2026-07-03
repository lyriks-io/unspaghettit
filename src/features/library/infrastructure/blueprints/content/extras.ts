import type { SurfaceBlueprint } from '../../../domain/entities/SurfaceBlueprint';
import { defineBrick } from '../_shared/brick';

/** Additional content bricks beyond Reviews, all authored via defineBrick. */

const blogPost = defineBrick({
  id: 'library.content.blog_post',
  name: 'Blog post editor',
  category: 'content',
  surfaceType: 'screen',
  summary: 'Write, draft, and publish a post with an idempotent publish guard.',
  description:
    'An article authoring surface. Drafts save freely; publishing validates the title and slug and is blocked once the post is already live.',
  surfaceName: 'Post',
  surfaceDescription: 'Compose and publish a blog article.',
  tags: ['content', 'blog', 'article', 'cms', 'publish'],
  states: [
    { path: 'post.published', type: 'boolean', default: false, description: 'Whether the post is live.' },
    { path: 'post.slug', type: 'string', default: '', description: 'URL slug.' },
    { path: 'post.wordCount', type: 'number', default: 0, description: 'Body length in words.' }
  ],
  invariants: [
    { name: 'Word count is non-negative', path: 'post.wordCount', op: 'greater_than', value: -1, message: 'Word count can never be negative.' }
  ],
  actions: [
    {
      name: 'Publish',
      intent: 'Make the post publicly visible.',
      emits: 'content.post.published',
      roles: ['primary', 'persistence'],
      requiredStates: ['post.published'],
      params: [
        { name: 'title', type: 'string', description: 'Post title.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 160 }] },
        { name: 'slug', type: 'string', description: 'URL slug.', bindTo: 'post.slug', validations: [{ type: 'non_empty' }, { type: 'slug' }] }
      ],
      rules: [
        { category: 'business', when: { path: 'post.published', op: 'is_true' }, block: 'This post is already published.' },
        { category: 'business', description: 'Flip the post to published.', set: { path: 'post.published', value: true } }
      ]
    },
    {
      name: 'Save draft',
      intent: 'Persist the current body as a draft.',
      emits: 'content.post.draft_saved',
      roles: ['persistence'],
      params: [
        { name: 'body', type: 'string', description: 'Article body.', required: false, defaultValue: '', validations: [{ type: 'max_length', value: 100000 }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Draft saved.', tone: 'success' } }]
    }
  ]
});

const commentThread = defineBrick({
  id: 'library.content.comment_thread',
  name: 'Comment thread',
  category: 'content',
  surfaceType: 'screen',
  summary: 'Threaded comments with a lock gate and moderator controls.',
  description:
    'A discussion under any piece of content. Comments are blocked on locked threads, and only moderators can lock or unlock.',
  surfaceName: 'Comments',
  surfaceDescription: 'Read and post comments on a piece of content.',
  tags: ['content', 'comments', 'discussion', 'moderation'],
  states: [
    { path: 'comments.count', type: 'number', default: 0, description: 'Comments in the thread.' },
    { path: 'comments.locked', type: 'boolean', default: false, description: 'Whether new comments are blocked.' },
    { path: 'comments.canModerate', type: 'boolean', default: false, description: 'Whether the viewer can moderate.' }
  ],
  invariants: [
    { name: 'Comment count is non-negative', path: 'comments.count', op: 'greater_than', value: -1, message: 'Comment count can never be negative.' }
  ],
  actions: [
    {
      name: 'Add comment',
      intent: 'Post a comment to the thread.',
      emits: 'content.comment.added',
      roles: ['primary'],
      requiredStates: ['comments.locked'],
      params: [
        { name: 'body', type: 'string', description: 'Comment text.', validations: [{ type: 'non_empty' }, { type: 'max_length', value: 2000 }] }
      ],
      rules: [
        { category: 'permissions', when: { path: 'comments.locked', op: 'is_true' }, block: 'This thread is locked.' }
      ]
    },
    {
      name: 'Lock thread',
      intent: 'Prevent further comments.',
      emits: 'content.thread.locked',
      roles: ['primary'],
      requiredStates: ['comments.canModerate'],
      rules: [
        { category: 'permissions', when: { path: 'comments.canModerate', op: 'is_false' }, block: 'Only moderators can lock threads.' },
        { category: 'business', description: 'Lock the thread.', set: { path: 'comments.locked', value: true } }
      ]
    }
  ]
});

const mediaGallery = defineBrick({
  id: 'library.content.media_gallery',
  name: 'Media gallery',
  category: 'content',
  surfaceType: 'screen',
  summary: 'Grid / carousel gallery with item open and view switching.',
  description:
    'A gallery of images or videos. Opening an item validates the id; the layout toggles between grid and carousel.',
  surfaceName: 'Gallery',
  surfaceDescription: 'Browse a collection of media items.',
  tags: ['content', 'gallery', 'media', 'images'],
  states: [
    { path: 'gallery.itemCount', type: 'number', default: 0, description: 'Items in the gallery.' },
    { path: 'gallery.selectedId', type: 'string', default: '', description: 'Currently open item.' },
    { path: 'gallery.view', type: 'enum', default: 'grid', description: 'Layout.', enumValues: ['grid', 'carousel'] }
  ],
  invariants: [
    { name: 'Item count is non-negative', path: 'gallery.itemCount', op: 'greater_than', value: -1, message: 'The item count can never be negative.' }
  ],
  actions: [
    {
      name: 'Open item',
      intent: 'Open a single media item.',
      emits: 'gallery.item.opened',
      roles: ['entry'],
      params: [
        { name: 'itemId', type: 'string', description: 'Media item id.', bindTo: 'gallery.selectedId', validations: [{ type: 'non_empty' }, { type: 'uuid' }] }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'Opening item.', tone: 'info' } }]
    },
    {
      name: 'Set view',
      intent: 'Switch between grid and carousel.',
      emits: 'gallery.view.changed',
      roles: ['primary'],
      params: [
        { name: 'view', type: 'enum', description: 'Layout.', enumValues: ['grid', 'carousel'], bindTo: 'gallery.view' }
      ],
      rules: [{ category: 'ux_feedback', message: { text: 'View changed.', tone: 'info' } }]
    }
  ]
});

export const contentExtraBlueprints: readonly SurfaceBlueprint[] = [blogPost, commentThread, mediaGallery];
