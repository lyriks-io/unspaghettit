import type { MaturityReport } from '$features/maturity/domain/MaturityReport';
import type { ExplorationReport } from '$features/simulator/domain/StateExplorer';
import type { SurfaceReachabilityReport } from '$features/simulator/domain/SurfaceReachability';
import type { RunScenariosOutput } from '$features/simulator/application/use-cases/RunScenarios';
import type { DriftEntry } from './DriftReport';
import type { EventHandlerFinding } from './EventCoherenceReport';
import type { VerifiedCoverage } from './verifiedCoverage';
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
  /** Dead event handlers in this feature (triggering event emitted by nothing in the project). */
  readonly deadHandlers?: readonly EventHandlerFinding[];
  /** Share of this feature's actions proven against code (verifiedAt stamped). */
  readonly verifiedCoverage?: VerifiedCoverage;
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
    ),
    traces: exploration.invariantViolations.map((v) => ({
      label: v.invariantName,
      path: v.path,
      surfaceId: v.surfaceId,
      actionId: v.actionId
    }))
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

const verifiedCheck = (
  coverage: VerifiedCoverage,
  thresholds: VerificationThresholds
): VerdictCheck => {
  const pct = coverage.total === 0 ? 100 : Math.round((coverage.verified / coverage.total) * 100);
  if (thresholds.minVerified <= 0) {
    return {
      id: 'verified',
      label: 'Verified',
      status: 'pass',
      detail: `${coverage.verified}/${coverage.total} action(s) proven against code (${pct}%, no gate)`
    };
  }
  return {
    id: 'verified',
    label: 'Verified',
    status: pct >= thresholds.minVerified ? 'pass' : 'fail',
    detail: `${pct}% of actions proven against code (${coverage.verified}/${coverage.total}, min ${thresholds.minVerified}%)`
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

const livenessCheck = (
  exploration: ExplorationReport,
  thresholds: VerificationThresholds
): VerdictCheck => {
  const unmet = exploration.goalResults.filter((g) => !g.satisfied);
  if (unmet.length === 0) {
    return {
      id: 'liveness',
      label: 'Liveness',
      status: 'pass',
      detail: `${exploration.goalResults.length} reachability goal(s) hold within bounds`
    };
  }
  return {
    id: 'liveness',
    label: 'Liveness',
    status: thresholds.failOnUnmetGoals ? 'fail' : 'warn',
    detail: `${unmet.length} reachability goal(s) unmet`,
    items: unmet.map((g) =>
      g.counterexamplePath && g.counterexamplePath.length > 0
        ? `${g.goalName} (${g.kind}) — trap via [${g.counterexamplePath.join(' → ')}]`
        : `${g.goalName} (${g.kind}) — never reached within bounds`
    ),
    traces: unmet
      .filter((g) => g.counterexamplePath && g.counterexamplePath.length > 0)
      .map((g) => ({ label: `${g.goalName} (${g.kind})`, path: g.counterexamplePath ?? [] }))
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
  const { scenarios, maturity, exploration, reachability, drift, deadHandlers, verifiedCoverage, thresholds } =
    input;
  const checks: VerdictCheck[] = [scenariosCheck(scenarios, thresholds)];

  if (exploration) {
    checks.push(invariantsCheck(exploration, thresholds));
    if (exploration.goalResults.length > 0) checks.push(livenessCheck(exploration, thresholds));
    checks.push(deadActionsCheck(exploration, thresholds));
    if (exploration.skippedActions.length > 0) {
      checks.push({
        id: 'skipped-actions',
        label: 'Unexplored actions',
        status: thresholds.failOnSkippedActions ? 'fail' : 'warn',
        detail: `${exploration.skippedActions.length} action(s) could not be exercised by model checking`,
        items: exploration.skippedActions.map((action) => `${action.actionName}: ${action.reason}`)
      });
    }
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
        status: thresholds.failOnTruncatedExploration ? 'fail' : 'warn',
        detail: 'model check truncated — findings are "within bounds", not a proof. Raise maxDepth/maxStates to widen.'
      });
    }
  }

  checks.push(maturityCheck(maturity, thresholds));

  if (verifiedCoverage) checks.push(verifiedCheck(verifiedCoverage, thresholds));

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

  if (deadHandlers && deadHandlers.length > 0) {
    checks.push({
      id: 'events',
      label: 'Event wiring',
      status: 'warn',
      detail: `${deadHandlers.length} handler(s) triggered by an event nothing in the project emits`,
      items: deadHandlers.map((h) => `${h.actionName} ← "${h.event}"`)
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
