import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Project } from '$features/projects/domain/entities/Project';
import {
  digestHasContent,
  type DigestDetailLevel,
  type DigestSpec
} from '$features/behavior-digest/domain/DigestSpec';
import type { DigestScopeRef } from '$features/behavior-digest/domain/ports/DigestProjector';
import { buildDigest } from '$features/behavior-digest/domain/services/buildDigest';
import { markdownDigestExporter } from '$features/behavior-digest/infrastructure/exporters/MarkdownDigestExporter';

/** How the digest comes back: the structured spec (default) or serialized Markdown. */
export type DigestFormat = 'spec' | 'markdown';

export type GetDigestInput = {
  /** The feature(s) the scope resolves against (one for feature/surface/action; all members for a project). */
  readonly features: readonly Feature[];
  /** The summarized project. Used (and only meaningful) for a `project` scope. */
  readonly project?: Project;
  readonly scope: DigestScopeRef;
  readonly detailLevel?: DigestDetailLevel;
  readonly format?: DigestFormat;
};

export type GetDigestOutput =
  | { readonly format: 'spec'; readonly hasContent: boolean; readonly digest: DigestSpec }
  | { readonly format: 'markdown'; readonly hasContent: boolean; readonly markdown: string };

/**
 * Project one scope of the behavior model into its plain-language digest — the
 * same "what happens here" summary the dashboard renders — as either the
 * structured `DigestSpec` (carries click-through element ids; the default) or
 * serialized Markdown (for pasting into a PR, README, or wiki).
 *
 * Thin orchestration over the behavior-digest projector + Markdown exporter: no
 * summarization logic lives here, so the MCP surface and the dashboard always
 * describe behavior identically. `hasContent` is false when the scope carries no
 * actions, guardrails, or navigation (an empty or unresolvable scope), so the
 * caller can tell "nothing to summarize" from a real summary.
 */
export const getDigestTool = (input: GetDigestInput): GetDigestOutput => {
  const spec = buildDigest({
    features: input.features,
    ...(input.project ? { project: input.project } : {}),
    scope: input.scope,
    ...(input.detailLevel ? { detailLevel: input.detailLevel } : {})
  });
  const hasContent = digestHasContent(spec);
  return input.format === 'markdown'
    ? { format: 'markdown', hasContent, markdown: markdownDigestExporter.export(spec) }
    : { format: 'spec', hasContent, digest: spec };
};
