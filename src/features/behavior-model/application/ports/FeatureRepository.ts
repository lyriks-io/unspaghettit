import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { Tag } from '$shared/domain/Tags';
import type { FeatureId } from '$features/behavior-model/domain/value-objects/ids';

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

export interface FeatureRepository {
  list(): Promise<readonly FeatureSummary[]>;
  get(id: FeatureId): Promise<Feature | null>;
  save(feature: Feature): Promise<void>;
  delete(id: FeatureId): Promise<void>;
}
