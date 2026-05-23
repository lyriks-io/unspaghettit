import type { Feature } from '$features/behavior-model/domain/entities/Feature';
import type {
  MaturityIssue,
  MaturityReport,
  MaturitySeverity
} from '$features/maturity/domain/MaturityReport';
import { scoreFeatureUseCase } from '$features/maturity/application/use-cases/ScoreFeature';

/**
 * Compact summary. Every numeric you need to decide "is this good enough?"
 * plus enough breakdown to know *where* to look. Stays under ~1 KB even on
 * a large feature.
 *
 * Drill-down is done by passing filters (`surfaceId`, `area`, `severity`) or
 * `includeIssues:true` to append the per-issue list. The *passedChecks* array
 * from the underlying MaturityReport is never exposed. Agents don't act on
 * "this check passed," and including it inflated the payload ~8× for no value.
 */
export type ScoreFeatureSummary = {
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly criticalIssueCount: number;
  readonly recommendedIssueCount: number;
  readonly passedCheckCount: number;
  /** Top N issue buckets by count, scoped to the active filter. */
  readonly issuesByArea: ReadonlyArray<{
    readonly area: string;
    readonly severity: MaturitySeverity;
    readonly count: number;
  }>;
  /** Top N surfaces by issue count, scoped to the active filter. */
  readonly worstSurfaces: ReadonlyArray<{
    readonly surfaceId: string;
    readonly surfaceName: string;
    readonly issueCount: number;
  }>;
  /**
   * Per-issue list. Omitted unless `includeIssues:true` was passed (or a
   * filter implicitly enabled inclusion. See options).
   */
  readonly issues?: readonly MaturityIssue[];
  /** Pointer telling the caller how to drill in. */
  readonly hint: string;
};

export type ScoreFeatureOutput = ScoreFeatureSummary;

export type ScoreFeatureOptions = {
  /**
   * Append the per-issue list. Without filters, the full ~25-40 KB issue array
   * is returned; pair with filters to stay under 10 KB. Default: false.
   */
  readonly includeIssues?: boolean;
  /** Restrict counts + issues to one surface. */
  readonly surfaceId?: string;
  /** Restrict counts + issues to one area (e.g. "events", "block handling"). */
  readonly area?: string;
  /** Restrict counts + issues to one severity. */
  readonly severity?: MaturitySeverity;
};

const TOP_AREAS = 5;
const TOP_SURFACES = 5;

const score = scoreFeatureUseCase();

const applyFilters = (
  issues: readonly MaturityIssue[],
  opts: ScoreFeatureOptions
): readonly MaturityIssue[] => {
  let scoped = issues;
  if (opts.surfaceId) scoped = scoped.filter((i) => i.surfaceId === opts.surfaceId);
  if (opts.area) scoped = scoped.filter((i) => i.area === opts.area);
  if (opts.severity) scoped = scoped.filter((i) => i.severity === opts.severity);
  return scoped;
};

const buildSummary = (
  feature: Feature,
  report: MaturityReport,
  opts: ScoreFeatureOptions
): ScoreFeatureSummary => {
  const allIssues = [...report.criticalIssues, ...report.recommendedIssues];
  const scoped = applyFilters(allIssues, opts);
  const hasFilter =
    opts.surfaceId !== undefined || opts.area !== undefined || opts.severity !== undefined;

  const byKey = new Map<string, { area: string; severity: MaturitySeverity; count: number }>();
  for (const issue of scoped) {
    const key = `${issue.area}::${issue.severity}`;
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { area: issue.area, severity: issue.severity, count: 1 });
  }
  const issuesByArea = [...byKey.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_AREAS);

  const surfaceNames = new Map<string, string>(
    feature.surfaces.map((s) => [String(s.id), s.name])
  );
  const surfaceCounts = new Map<string, number>();
  for (const issue of scoped) {
    const sid = issue.surfaceId;
    if (!sid) continue;
    surfaceCounts.set(sid, (surfaceCounts.get(sid) ?? 0) + 1);
  }
  const worstSurfaces = [...surfaceCounts.entries()]
    .map(([surfaceId, issueCount]) => ({
      surfaceId,
      surfaceName: surfaceNames.get(surfaceId) ?? '(unknown surface)',
      issueCount
    }))
    .sort((a, b) => b.issueCount - a.issueCount)
    .slice(0, TOP_SURFACES);

  const critScoped = scoped.filter((i) => i.severity === 'critical').length;
  const recScoped = scoped.filter((i) => i.severity === 'recommended').length;

  const summary: ScoreFeatureSummary = {
    score: report.score,
    maxScore: report.maxScore,
    percentage: report.percentage,
    criticalIssueCount: hasFilter ? critScoped : report.criticalIssues.length,
    recommendedIssueCount: hasFilter ? recScoped : report.recommendedIssues.length,
    passedCheckCount: report.passedChecks.length,
    issuesByArea,
    worstSurfaces,
    hint:
      'Compact summary. Add includeIssues:true to append the issue array, or pass surfaceId / area / severity to scope counts and the issue array.'
  };

  if (opts.includeIssues) {
    return { ...summary, issues: scoped };
  }
  return summary;
};

export const scoreFeatureTool = (
  feature: Feature,
  opts: ScoreFeatureOptions = {}
): ScoreFeatureOutput => buildSummary(feature, score(feature), opts);

/**
 * Escape hatch for the demo route that wants every passing check + issue.
 * NOT exposed via the MCP. The per-check verbose dump routinely blows past
 * agent token budgets and offers no actionable value to a caller.
 */
export const scoreFeatureFullReport = (feature: Feature): MaturityReport =>
  score(feature);

export type { MaturityIssue };
