import type { MaturityReport } from '$features/maturity/domain/MaturityReport';
import type { ExplorationReport } from '$features/simulator/domain/StateExplorer';
import type { SurfaceReachabilityReport } from '$features/simulator/domain/SurfaceReachability';
import type { RunScenariosOutput } from '$features/simulator/application/use-cases/RunScenarios';
import type { DriftEntry } from './DriftReport';
import type { VerificationThresholds } from './VerificationThresholds';
import { verdictPassed, type FeatureVerdict, type VerdictCheck } from './VerificationVerdict';

/**
 * Everything verifying one feature produced, plus the gate. The exploration and
 * reachability reports are optional: model-checking is opt-in (it can be the
 * expensive part), and when it's skipped those checks simply don't appear.
 */
export type FeatureVerdictInput = {
  readonly featureId: string;
  readonly featureName: string;
  readonly scenarios: RunScenariosOutput;
  readonly maturity: MaturityReport;
  readonly exploration?: ExplorationReport;
  readonly reachability?: SurfaceReachabilityReport;
  /** Drift entries already filtered to this feature. */
  readonly drift: readonly DriftEntry[];
  readonly thresholds: VerificationThresholds;
};

const scenariosCheck = (
  scenarios: RunScenariosOutput,
  thresholds: VerificationThresholds
): VerdictCheck => {
  if (scenarios.total === 0) {
    return thresholds.requireScenarios
      ? { id: 'scenarios', label: 'Scenarios', status: 'fail', detail: 'no scenarios authored (required)' }
      : { id: 'scenarios', label: 'Scenarios', status: 'warn', detail: 'no scenarios authored' };
  }
  if (scenarios.failed > thresholds.maxScenarioFailures) {
    return {
      id: 'scenarios',
      label: 'Scenarios',
      status: 'fail',
      detail: `${scenarios.failed}/${scenarios.total} failing (max ${thresholds.maxScenarioFailures})`,
      items: scenarios.results.filter((r) => !r.pass).map((r) => `${r.actionName} › ${r.scenarioName}`)
    };
  }
  return {
    id: 'scenarios',
    label: 'Scenarios',
    status: 'pass',
    detail: `${scenarios.passed}/${scenarios.total} passing`
  };
};

const invariantsCheck = (
  exploration: ExplorationReport,
  thresholds: VerificationThresholds
): VerdictCheck => {
  if (exploration.invariantViolations.length === 0) {
    return { id: 'invariants', label: 'Invariants', status: 'pass', detail: 'no reachable violation within bounds' };
  }
  return {
    id: 'invariants',
    label: 'Invariants',
    status: thresholds.allowInvariantViolations ? 'warn' : 'fail',
    detail: `${exploration.invariantViolations.length} reachable violation(s)`,
    items: exploration.invariantViolations.map(
      (v) => `${v.invariantName} via [${v.path.join(' → ')}]`
    )
  };
};

const maturityCheck = (
  maturity: MaturityReport,
  thresholds: VerificationThresholds
): VerdictCheck => {
  if (thresholds.minMaturity <= 0) {
    return { id: 'maturity', label: 'Maturity', status: 'pass', detail: `${maturity.percentage}% (no gate)` };
  }
  const passed = maturity.percentage >= thresholds.minMaturity;
  return {
    id: 'maturity',
    label: 'Maturity',
    status: passed ? 'pass' : 'fail',
    detail: `${maturity.percentage}% (min ${thresholds.minMaturity}%)`,
    ...(passed
      ? {}
      : { items: maturity.criticalIssues.slice(0, 10).map((i) => `${i.area}: ${i.message}`) })
  };
};

const reachabilityCheck = (reachability: SurfaceReachabilityReport): VerdictCheck => {
  if (reachability.unreachableSurfaces.length === 0) {
    return { id: 'reachability', label: 'Reachability', status: 'pass', detail: 'every surface is reachable' };
  }
  return {
    id: 'reachability',
    label: 'Reachability',
    status: 'warn',
    detail: `${reachability.unreachableSurfaces.length} surface(s) unreachable by navigation`,
    items: reachability.unreachableSurfaces.map((s) => s.surfaceName)
  };
};

const deadActionsCheck = (
  exploration: ExplorationReport,
  thresholds: VerificationThresholds
): VerdictCheck => {
  if (exploration.deadActions.length === 0) {
    return { id: 'dead-actions', label: 'Dead actions', status: 'pass', detail: 'none within bounds' };
  }
  return {
    id: 'dead-actions',
    label: 'Dead actions',
    status: thresholds.failOnDeadActions ? 'fail' : 'warn',
    detail: `${exploration.deadActions.length} action(s) never fired within bounds`,
    items: exploration.deadActions.map((a) => a.actionName)
  };
};

const aggregateChecks = (input: FeatureVerdictInput): VerdictCheck[] => {
  const { scenarios, maturity, exploration, reachability, drift, thresholds } = input;
  const checks: VerdictCheck[] = [scenariosCheck(scenarios, thresholds)];

  if (exploration) {
    checks.push(invariantsCheck(exploration, thresholds));
    checks.push(deadActionsCheck(exploration, thresholds));
    if (exploration.deadlockStates > 0) {
      checks.push({
        id: 'deadlocks',
        label: 'Deadlocks',
        status: 'warn',
        detail: `${exploration.deadlockStates} reachable state(s) with no enabled action (may be legitimate terminals)`
      });
    }
    if (exploration.truncated) {
      checks.push({
        id: 'bounds',
        label: 'Search bounds',
        status: 'warn',
        detail: 'model check truncated — findings are "within bounds", not a proof. Raise maxDepth/maxStates to widen.'
      });
    }
  }

  checks.push(maturityCheck(maturity, thresholds));

  if (reachability) checks.push(reachabilityCheck(reachability));

  if (drift.length > 0) {
    checks.push({
      id: 'drift',
      label: 'Drift',
      status: thresholds.allowDrift ? 'warn' : 'fail',
      detail: `${drift.length} implementation(s) audited against an older spec`,
      items: drift.map((d) => `${d.key} (audited ${d.auditedSpecVersion}, now ${d.currentSpecVersion})`)
    });
  }

  return checks;
};

export const aggregateFeatureVerdict = (input: FeatureVerdictInput): FeatureVerdict => {
  const checks = aggregateChecks(input);
  return {
    featureId: input.featureId,
    featureName: input.featureName,
    passed: verdictPassed(checks),
    checks
  };
};
