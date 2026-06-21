import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Tag } from '$shared/domain/Tags';

/**
 * Every distinct kind of thing the global search can surface. One per modeled
 * element type, plus the two navigable container pages (project, domain).
 * Tags are NOT a kind: tag text is folded into the owning project/feature
 * haystack so a tag query still finds its carrier.
 */
export type SearchEntityKind =
  | 'project'
  | 'domain'
  | 'feature'
  | 'surface'
  | 'action'
  | 'parameter'
  | 'rule'
  | 'invariant'
  | 'effect'
  | 'state'
  | 'transition'
  | 'persona'
  | 'resource'
  | 'entity'
  | 'entity-field'
  | 'event'
  | 'value-set'
  | 'scenario';

/** Where clicking a result takes the user — a dashboard route + query. */
export type SearchNavTarget = {
  readonly href: string;
};

/**
 * A flattened, indexable record for ONE modeled element. The single shape the
 * UI renders and the scorer ranks. `haystack` is a precomputed, lowercased
 * corpus (title + subtitle + breadcrumb + tags) so matching never re-walks the
 * model. Pure data — no framework, no ids beyond plain strings.
 */
export type SearchDoc = {
  /** Stable, unique key, e.g. `action:<featureId>:<actionId>`. */
  readonly id: string;
  readonly kind: SearchEntityKind;
  /** Primary display text: a name, a humanized state path, a value-set name… */
  readonly title: string;
  /** Secondary display text: an intent, a description, a type label. */
  readonly subtitle?: string;
  // Breadcrumb context (also mixed into the haystack for secondary matching).
  readonly projectId?: string;
  readonly projectName?: string;
  readonly featureId?: string;
  readonly featureName?: string;
  readonly surfaceId?: string;
  readonly surfaceName?: string;
  /** Precomputed lowercased search corpus. */
  readonly haystack: string;
  readonly nav: SearchNavTarget;
};

/**
 * Minimal project shape the index builder needs. Kept local so the domain
 * layer doesn't depend on the projects application-port types.
 */
export type SearchProjectInput = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly featureIds: readonly string[];
};

/** Minimal domain (project-grouping) shape the index builder needs. */
export type SearchDomainInput = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
};

/** Everything `buildSearchDocs` reads to produce the index. */
export type SearchModelInput = {
  readonly projects: readonly SearchProjectInput[];
  readonly features: readonly Feature[];
  readonly domains: readonly SearchDomainInput[];
};

/**
 * Display order of result groups. Containers first (most navigated-to), then
 * the structural spine, then leaf elements. The UI renders sections in this
 * order; kinds absent from a result set are simply skipped.
 */
export const SEARCH_GROUP_ORDER: readonly SearchEntityKind[] = [
  'project',
  'domain',
  'feature',
  'surface',
  'action',
  'state',
  'rule',
  'invariant',
  'effect',
  'parameter',
  'transition',
  'event',
  'entity',
  'entity-field',
  'value-set',
  'resource',
  'persona',
  'scenario'
];
