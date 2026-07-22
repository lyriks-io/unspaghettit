import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type { MaturityIssue, MaturityReport } from './MaturityReport';
import { scoreFeature, scoreFeatureBreakdown } from './MaturityScorer';

/**
 * One area's contribution to the score, at the level it was checked. This is
 * what a consumer needs to render or gate on a maturity number WITHOUT
 * re-deriving the weights.
 */
export type MaturityBreakdownEntry = {
  readonly level: 'feature' | 'surface' | 'action';
  readonly targetId?: string;
  readonly targetName: string;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
};

export type FeatureMaturity = {
  readonly featureId: string;
  readonly featureName: string;
  /** Checks passed. Every check currently weighs 1. */
  readonly score: number;
  /** Checks applicable to this feature. */
  readonly maxScore: number;
  /** `round(score / maxScore * 100)`, or 100 when nothing applies. */
  readonly percentage: number;
  readonly criticalIssues: readonly MaturityIssue[];
  readonly recommendedIssues: readonly MaturityIssue[];
  readonly breakdown: readonly MaturityBreakdownEntry[];
};

/**
 * THE maturity number, as one pure function over a Feature.
 *
 * Exists because consumers outside this repo (the Lyriks platform's offline /
 * air-gapped mode) need the same score the dashboard and `verify` report, and
 * were hand-copying the check weights out of `MaturityScorer` — two formulas
 * that drift apart on every engine release, silently. Calling this instead
 * means there is exactly one definition of "how mature is this feature".
 *
 * Deliberately NOT a TRL number: the engine has no TRL concept, and inventing a
 * 1-9 scale here would just be a second formula to keep in sync. `percentage`
 * plus `breakdown` is the raw material; map it to whatever ladder you publish.
 *
 * Pure and synchronous: no clock, no I/O, no repository. Safe to call in a
 * loop, in a worker, or offline.
 */
export const computeFeatureMaturity = (feature: Feature): FeatureMaturity => {
  const report: MaturityReport = scoreFeature(feature);
  const detail = scoreFeatureBreakdown(feature);

  const entry = (
    level: MaturityBreakdownEntry['level'],
    targetName: string,
    part: MaturityReport,
    targetId?: string
  ): MaturityBreakdownEntry => ({
    level,
    ...(targetId !== undefined ? { targetId } : {}),
    targetName,
    score: part.score,
    maxScore: part.maxScore,
    percentage: part.percentage
  });

  return {
    featureId: String(feature.id),
    featureName: feature.name,
    score: report.score,
    maxScore: report.maxScore,
    percentage: report.percentage,
    criticalIssues: report.criticalIssues,
    recommendedIssues: report.recommendedIssues,
    breakdown: [
      entry('feature', feature.name, detail.featureLevel),
      ...detail.perSurface.flatMap((surface) => [
        entry('surface', surface.surface.name, surface.surfaceLevel, String(surface.surface.id)),
        ...surface.perAction.map((action) =>
          entry('action', action.action.name, action.report, String(action.action.id))
        )
      ])
    ]
  };
};
