import type { Feature } from '../entities/Feature';
import type { FeatureId } from '../value-objects/ids';
import { normalizeTags, type Tag } from '$shared/domain/Tags';

export type FeatureSummary = {
  readonly id: FeatureId;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly Tag[];
  readonly surfaceCount: number;
  readonly actionCount: number;
  /**
   * Rollup counts that are SUMMABLE across features, so a caller can render a
   * total without fetching every full Feature.
   *
   * They exist because the project page's sidebar counters were derived from
   * the fully-loaded features, which arrive as one request PER feature — so
   * every counter read 0 until the last one landed. The summary is a single
   * request and the repository already parses each file to build it, so these
   * cost nothing extra on the server and make the counters correct on first
   * paint.
   *
   * Deliberately only the summable ones: resources / entities / events /
   * transitions are DEDUPLICATED across features when displayed (one `users`
   * table referenced by two flows is one row), so a sum would overcount. Those
   * stay exact-or-unknown rather than fast-and-wrong.
   *
   * Optional for back-compat: a summary from an older server omits them, and
   * callers read `?? undefined` and fall back to "unknown".
   */
  readonly stateCount?: number;
  readonly surfaceRuleCount?: number;
  readonly personaCount?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * Build a Feature's summary. ONE definition, shared by every repository, so the
 * counts a client renders can't depend on which adapter answered.
 *
 * Every count here is SUMMABLE across features (see `FeatureSummary`), which is
 * what lets the project page total them without loading a single full Feature.
 */
export const summarizeFeature = (feature: Feature): FeatureSummary => ({
  id: feature.id,
  name: feature.name,
  description: feature.description,
  tags: normalizeTags(feature.tags),
  surfaceCount: feature.surfaces.length,
  actionCount: feature.surfaces.reduce((acc, s) => acc + s.actions.length, 0),
  stateCount: feature.surfaces.reduce((acc, s) => acc + s.stateDefinitions.length, 0),
  surfaceRuleCount: feature.surfaces.reduce((acc, s) => acc + s.rules.length, 0),
  personaCount: feature.personas.length,
  createdAt: feature.createdAt,
  updatedAt: feature.updatedAt
});
