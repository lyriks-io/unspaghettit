/**
 * SurfacePanel tabs an issue can deep-link into. Mirrors the literal tab keys
 * the SurfacePanel component uses.
 */
export type SurfacePanelTab =
  | 'actions'
  | 'state'
  | 'rules'
  | 'invariants'
  | 'data'
  | 'resources'
  | 'personas';

export type MaturitySeverity = 'critical' | 'recommended';

/**
 * Navigation hints attached to every check (passed or failed) so the UI can
 * jump to the exact place a fix is needed. Surface, action, tab.
 */
export type CheckLocation = {
  readonly surfaceId?: string;
  readonly actionId?: string;
  readonly surfacePanelTab?: SurfacePanelTab;
};

export type MaturityIssue = CheckLocation & {
  readonly target: string;
  readonly targetKind: 'feature' | 'surface' | 'action';
  readonly area: string;
  readonly message: string;
  readonly severity: MaturitySeverity;
};

export type PassedCheck = CheckLocation & {
  readonly target: string;
  readonly targetKind: 'feature' | 'surface' | 'action';
  readonly area: string;
  readonly message: string;
};

export type MaturityReport = {
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly criticalIssues: readonly MaturityIssue[];
  readonly recommendedIssues: readonly MaturityIssue[];
  readonly passedChecks: readonly PassedCheck[];
};

export const emptyReport = (): MaturityReport => ({
  score: 0,
  maxScore: 0,
  percentage: 100,
  criticalIssues: [],
  recommendedIssues: [],
  passedChecks: []
});

export const combineReports = (a: MaturityReport, b: MaturityReport): MaturityReport => {
  const score = a.score + b.score;
  const maxScore = a.maxScore + b.maxScore;
  return {
    score,
    maxScore,
    percentage: maxScore === 0 ? 100 : Math.round((score / maxScore) * 100),
    criticalIssues: [...a.criticalIssues, ...b.criticalIssues],
    recommendedIssues: [...a.recommendedIssues, ...b.recommendedIssues],
    passedChecks: [...a.passedChecks, ...b.passedChecks]
  };
};
