import { describe, expect, it } from 'vitest';
import { mergeVerificationReports, type VerificationReport } from './VerificationReport';

const report = (over: Partial<VerificationReport> = {}): VerificationReport => ({
  passed: true,
  features: [],
  drift: { stale: [], unversioned: [], orphans: [], checked: 0 },
  eventCoherence: { deadHandlers: [] },
  summary: {
    featuresChecked: 0,
    featuresPassed: 0,
    featuresFailed: 0,
    scenariosRun: 0,
    scenariosFailed: 0,
    invariantViolations: 0
  },
  ...over
});

describe('mergeVerificationReports', () => {
  it('folds per-cohort reports into one aggregate', () => {
    const a = report({
      passed: true,
      features: [{ featureId: 'a', featureName: 'A', passed: true, checks: [], scenarios: [] }],
      drift: { stale: [], unversioned: ['k1'], orphans: [], checked: 2 },
      summary: { featuresChecked: 1, featuresPassed: 1, featuresFailed: 0, scenariosRun: 3, scenariosFailed: 0, invariantViolations: 0 }
    });
    const b = report({
      passed: false,
      features: [{ featureId: 'b', featureName: 'B', passed: false, checks: [], scenarios: [] }],
      drift: { stale: [], unversioned: [], orphans: [{ key: 'x', reason: 'gone' }], checked: 1 },
      summary: { featuresChecked: 1, featuresPassed: 0, featuresFailed: 1, scenariosRun: 4, scenariosFailed: 2, invariantViolations: 1 }
    });

    const merged = mergeVerificationReports([a, b]);
    expect(merged.passed).toBe(false);
    expect(merged.features.map((f) => f.featureId)).toEqual(['a', 'b']);
    expect(merged.drift.checked).toBe(3);
    expect(merged.drift.unversioned).toEqual(['k1']);
    expect(merged.drift.orphans).toHaveLength(1);
    expect(merged.summary).toMatchObject({
      featuresChecked: 2,
      featuresPassed: 1,
      featuresFailed: 1,
      scenariosRun: 7,
      scenariosFailed: 2,
      invariantViolations: 1
    });
  });

  it('returns a clean empty report for no cohorts', () => {
    const merged = mergeVerificationReports([]);
    expect(merged.passed).toBe(true);
    expect(merged.features).toEqual([]);
    expect(merged.summary.featuresChecked).toBe(0);
  });
});
