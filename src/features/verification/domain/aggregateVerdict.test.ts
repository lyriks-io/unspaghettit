import { describe, expect, it } from 'vitest';
import type { MaturityReport } from '$features/maturity/domain/MaturityReport';
import type { ExplorationReport } from '$features/simulator/domain/StateExplorer';
import type {
  RunScenariosOutput,
  ScenarioRunResult
} from '$features/simulator/application/use-cases/RunScenarios';
import { aggregateFeatureVerdict, type FeatureVerdictInput } from './aggregateVerdict';
import type { DriftEntry } from './DriftReport';
import { withThresholdDefaults } from './VerificationThresholds';

const scenarios = (total: number, failed: number): RunScenariosOutput => ({
  featureId: 'f',
  featureName: 'F',
  total,
  passed: total - failed,
  failed,
  results: Array.from({ length: failed }, (_, i) => ({
    pass: false,
    actionName: `Action ${i}`,
    scenarioName: `Scenario ${i}`
  })) as unknown as ScenarioRunResult[]
});

const maturity = (percentage: number): MaturityReport => ({
  score: percentage,
  maxScore: 100,
  percentage,
  criticalIssues: [],
  recommendedIssues: [],
  passedChecks: []
});

const exploration = (partial: Partial<ExplorationReport> = {}): ExplorationReport => ({
  statesExplored: 10,
  depthReached: 3,
  truncated: false,
  invariantViolations: [],
  deadActions: [],
  deadlockStates: 0,
  skippedActions: [],
  goalResults: [],
  ...partial
});

const base = (over: Partial<FeatureVerdictInput> = {}): FeatureVerdictInput => ({
  featureId: 'f',
  featureName: 'F',
  scenarios: scenarios(2, 0),
  maturity: maturity(100),
  drift: [],
  thresholds: withThresholdDefaults(),
  ...over
});

const checkById = (verdict: ReturnType<typeof aggregateFeatureVerdict>, id: string) =>
  verdict.checks.find((c) => c.id === id);

describe('aggregateFeatureVerdict', () => {
  it('passes a clean feature with all scenarios green', () => {
    const verdict = aggregateFeatureVerdict(base());
    expect(verdict.passed).toBe(true);
    expect(checkById(verdict, 'scenarios')?.status).toBe('pass');
  });

  it('fails when scenarios fail beyond the tolerance', () => {
    const verdict = aggregateFeatureVerdict(base({ scenarios: scenarios(3, 1) }));
    expect(verdict.passed).toBe(false);
    const check = checkById(verdict, 'scenarios');
    expect(check?.status).toBe('fail');
    expect(check?.items).toEqual(['Action 0 › Scenario 0']);
  });

  it('fails on a reachable invariant violation, unless explicitly allowed', () => {
    const violated = exploration({
      invariantViolations: [
        {
          invariantId: 'inv1',
          invariantName: 'balance >= 0',
          surfaceId: 's',
          actionId: 'a',
          actionName: 'Withdraw',
          path: ['Deposit', 'Withdraw']
        }
      ]
    });

    const failing = aggregateFeatureVerdict(base({ exploration: violated }));
    expect(failing.passed).toBe(false);
    expect(checkById(failing, 'invariants')?.items).toEqual(['balance >= 0 via [Deposit → Withdraw]']);

    const allowed = aggregateFeatureVerdict(
      base({
        exploration: violated,
        thresholds: withThresholdDefaults({ allowInvariantViolations: true })
      })
    );
    expect(allowed.passed).toBe(true);
    expect(checkById(allowed, 'invariants')?.status).toBe('warn');
  });

  it('treats drift as a warning by default and a failure when gated', () => {
    const drift: DriftEntry[] = [
      {
        key: 'action:a1',
        entitySuffix: 'a1',
        featureId: 'f',
        featureName: 'F',
        status: 'implemented',
        auditedSpecVersion: '2026-06-01T00:00:00.000Z',
        currentSpecVersion: '2026-06-10T00:00:00.000Z'
      }
    ];

    const warned = aggregateFeatureVerdict(base({ drift }));
    expect(warned.passed).toBe(true);
    expect(checkById(warned, 'drift')?.status).toBe('warn');

    const gated = aggregateFeatureVerdict(
      base({ drift, thresholds: withThresholdDefaults({ allowDrift: false }) })
    );
    expect(gated.passed).toBe(false);
    expect(checkById(gated, 'drift')?.status).toBe('fail');
  });

  it('enforces a maturity floor when one is set', () => {
    const verdict = aggregateFeatureVerdict(
      base({ maturity: maturity(50), thresholds: withThresholdDefaults({ minMaturity: 80 }) })
    );
    expect(verdict.passed).toBe(false);
    expect(checkById(verdict, 'maturity')?.detail).toContain('50%');
  });

  it('treats an unmet reachability goal as a warning by default and a failure when gated', () => {
    const withUnmetGoal = exploration({
      goalResults: [
        {
          goalId: 'g1',
          goalName: 'order reaches delivered',
          kind: 'always_reachable',
          satisfied: false,
          counterexamplePath: ['Cancel order']
        }
      ]
    });

    const warned = aggregateFeatureVerdict(base({ exploration: withUnmetGoal }));
    expect(warned.passed).toBe(true);
    expect(checkById(warned, 'liveness')?.status).toBe('warn');
    expect(checkById(warned, 'liveness')?.items?.[0]).toContain('Cancel order');

    const gated = aggregateFeatureVerdict(
      base({ exploration: withUnmetGoal, thresholds: withThresholdDefaults({ failOnUnmetGoals: true }) })
    );
    expect(gated.passed).toBe(false);
    expect(checkById(gated, 'liveness')?.status).toBe('fail');
  });

  it('omits the liveness check when no goals are declared', () => {
    const verdict = aggregateFeatureVerdict(base({ exploration: exploration() }));
    expect(checkById(verdict, 'liveness')).toBeUndefined();
  });

  it('gates on verified coverage only when a floor is set', () => {
    const cov = { verified: 1, total: 2 }; // 50% proven

    const ungated = aggregateFeatureVerdict(base({ verifiedCoverage: cov }));
    expect(ungated.passed).toBe(true);
    expect(checkById(ungated, 'verified')?.status).toBe('pass');
    expect(checkById(ungated, 'verified')?.detail).toContain('1/2');

    const gated = aggregateFeatureVerdict(
      base({ verifiedCoverage: cov, thresholds: withThresholdDefaults({ minVerified: 80 }) })
    );
    expect(gated.passed).toBe(false);
    expect(checkById(gated, 'verified')?.status).toBe('fail');
  });

  it('warns (never fails) when the model check was truncated', () => {
    const verdict = aggregateFeatureVerdict(base({ exploration: exploration({ truncated: true }) }));
    expect(verdict.passed).toBe(true);
    expect(checkById(verdict, 'bounds')?.status).toBe('warn');
  });
});
