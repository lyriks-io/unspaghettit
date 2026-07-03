import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';
import type { DigestDetailLevel, DigestSpec } from '../DigestSpec';

/**
 * Points a digest at exactly one scope of the model. A discriminated union so
 * the projector knows whether to summarize a whole project, a whole feature,
 * one surface, or a single action, and which one.
 */
export type DigestScopeRef =
  | { readonly kind: 'project' }
  | { readonly kind: 'feature'; readonly featureId: string }
  | { readonly kind: 'surface'; readonly featureId: string; readonly surfaceId: string }
  | {
      readonly kind: 'action';
      readonly featureId: string;
      readonly surfaceId: string;
      readonly actionId: string;
    };

/**
 * The read-only slice of the behavior model a digest is built from, plus the
 * scope to summarize and how much to say. The digest bounded context consumes
 * the model; it never mutates it. `project` names the summarized project (for a
 * `project` scope) and is ignored for the narrower scopes.
 */
export type DigestSource = {
  readonly features: readonly Feature[];
  readonly project?: Project;
  readonly scope: DigestScopeRef;
  /** Defaults to `standard` when omitted. */
  readonly detailLevel?: DigestDetailLevel;
};

/**
 * A DigestProjector turns a scope of the behavior model into a plain-language
 * `DigestSpec`. Pure: no IO, no mutation of the source model. Total: an
 * unresolvable scope yields an empty digest rather than throwing. The panel
 * depends on this port, not on the concrete projector (reverse DI).
 */
export type DigestProjector = {
  project(source: DigestSource): DigestSpec;
};
